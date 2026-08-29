import { createClient } from "npm:@supabase/supabase-js@2";

// Canal para que Pescador POS jale las solicitudes de cancelacion/
// sustitucion (y cambio de forma de pago sobre una venta YA facturada) que
// Oficina dejo pendientes, y reporte como quedaron -- aplicada (con o sin
// exito) o rechazada por la sucursal. A diferencia de pos-correcciones-pago,
// esto NUNCA se aplica solo: el POS siempre muestra un dialogo de
// confirmacion antes de tocar el SAT. Mismo patron de auth que las demas:
// header x-pos-secret, el POS siempre inicia la conexion.
//
// GET  ?sucursal=Florida                                -> pendientes para esa sucursal
// POST { id, estado: "aplicada"|"rechazada", resultado, resuelta_por }
//      -> resuelve una solicitud

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secretoEsperado = Deno.env.get("POS_SHARED_SECRET");
  const secretoRecibido = req.headers.get("x-pos-secret");
  if (!secretoEsperado || secretoRecibido !== secretoEsperado) {
    return json({ error: "No autorizado" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SERVICE_ROLE_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceKey);

  try {
    if (req.method === "GET") {
      const sucursal = new URL(req.url).searchParams.get("sucursal");
      if (!sucursal) return json({ error: "Falta el parametro sucursal" }, 400);

      const { data, error } = await adminClient
        .from("acciones_venta_pendientes")
        .select("id, folio, turno_id, tipo, forma_pago_nueva, motivo, creada_por, creada_at")
        .eq("sucursal", sucursal)
        .eq("estado", "pendiente")
        .order("creada_at");

      if (error) return json({ error: error.message }, 400);
      return json({ pendientes: data ?? [] });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const id: string | undefined = body?.id;
      const estado: string = body?.estado;
      if (!id || !["aplicada", "rechazada"].includes(estado)) {
        return json({ error: "Falta id o estado invalido (aplicada|rechazada)" }, 400);
      }

      const { error } = await adminClient
        .from("acciones_venta_pendientes")
        .update({
          estado,
          resultado: body?.resultado ?? null,
          resuelta_por: body?.resuelta_por ?? null,
          resuelta_at: new Date().toISOString(),
          visto_por_oficina: false,
        })
        .eq("id", id)
        .eq("estado", "pendiente"); // no pisar una que ya se resolvio de otro lado

      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Metodo no permitido" }, 405);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
