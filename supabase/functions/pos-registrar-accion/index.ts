import { createClient } from "npm:@supabase/supabase-js@2";

// Pescador POS empuja aqui un registro cada vez que cancela o sustituye un
// CFDI POR SU CUENTA (no porque Oficina se lo haya pedido en
// acciones_venta_pendientes -- esas ya quedan visibles al resolverse) --
// para que Oficina se entere sin tener que preguntarle al restaurante.
// Mismo patron de auth: header x-pos-secret, el POS siempre inicia.
//
// POST { sucursal, folio, tipo: "cancelacion"|"sustitucion", detalle, usuario }

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
  if (req.method !== "POST") return json({ error: "Metodo no permitido" }, 405);

  const secretoEsperado = Deno.env.get("POS_SHARED_SECRET");
  const secretoRecibido = req.headers.get("x-pos-secret");
  if (!secretoEsperado || secretoRecibido !== secretoEsperado) {
    return json({ error: "No autorizado" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SERVICE_ROLE_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json();
    const sucursal: string | undefined = body?.sucursal;
    const tipo: string = body?.tipo;
    if (!sucursal || !["cancelacion", "sustitucion"].includes(tipo)) {
      return json({ error: "Falta sucursal o tipo invalido (cancelacion|sustitucion)" }, 400);
    }

    const { error } = await adminClient.from("acciones_pos_directas").insert({
      sucursal,
      folio: body?.folio ?? null,
      tipo,
      detalle: body?.detalle ?? null,
      usuario: body?.usuario ?? null,
    });

    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
