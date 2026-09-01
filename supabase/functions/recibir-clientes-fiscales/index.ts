import { createClient } from "npm:@supabase/supabase-js@2";

// Recibe el catálogo de clientes fiscales (RFC, razón social, régimen,
// CP, email -- solo lo necesario para facturar, nada más) que cada
// sucursal ya trae guardado localmente (clientes_fiscales en Pescador
// POS, clientes en Hotel Sistema) y arma un directorio consolidado en
// Oficina -- "por si acaso se necesita" (pedido explícito del dueño), y
// también para autocompletar "Facturar folio individual" con clientes
// que ya facturaron en OTRA sucursal. Mismo secreto compartido que
// recibir-corte-pos (header x-pos-secret), no login de usuario.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-pos-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function entidadDeSucursal(nombre: string): string | null {
  const n = (nombre || "").toLowerCase();
  if (n.includes("hotel")) return "HOT";
  if (n.includes("puebla")) return "PUE";
  if (n.includes("florida")) return "FLO";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const secretoEsperado = Deno.env.get("POS_SHARED_SECRET");
    const secretoRecibido = req.headers.get("x-pos-secret");
    if (!secretoEsperado || secretoRecibido !== secretoEsperado) {
      return json({ error: "No autorizado" }, 401);
    }

    const body = await req.json();
    const { sucursal, clientes } = body ?? {};
    if (!sucursal || !Array.isArray(clientes)) {
      return json({ error: "sucursal y clientes (array) son obligatorios" }, 400);
    }
    const entidad = entidadDeSucursal(sucursal);
    if (!entidad) return json({ error: `No se reconoce la sucursal "${sucursal}"` }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SERVICE_ROLE_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    let procesados = 0;
    const errores: string[] = [];
    for (const c of clientes) {
      const rfc = String(c?.rfc || "").trim().toUpperCase();
      const razonSocial = String(c?.razon_social || "").trim();
      if (!rfc || !razonSocial) continue;

      const { data: existente } = await db.from("clientes_fiscales").select("sucursales").eq("rfc", rfc).maybeSingle();
      const sucursales = new Set<string>(existente?.sucursales ?? []);
      sucursales.add(entidad);

      const { error } = await db.from("clientes_fiscales").upsert({
        rfc, razon_social: razonSocial,
        regimen_fiscal: c.regimen_fiscal || null,
        uso_cfdi: c.uso_cfdi || null,
        cp: c.cp || null,
        email: c.email || null,
        sucursales: [...sucursales],
        ultima_factura: c.ultima_factura || null,
        actualizado_en: new Date().toISOString(),
      }, { onConflict: "rfc" });
      if (error) errores.push(`${rfc}: ${error.message}`);
      else procesados++;
    }

    return json({ ok: true, procesados, total: clientes.length, errores: errores.slice(0, 10) });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
