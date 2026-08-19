import { createClient } from "npm:@supabase/supabase-js@2";

// Canal para que Pescador POS (sistema de escritorio aparte) jale las
// correcciones de metodo de pago que Oficina fue dejando pendientes al
// revisar los folios de un corte, y confirme cuales ya aplico. El POS
// siempre inicia la conexion (no tiene servidor expuesto), igual que
// recibir-corte-pos -- se autentica con el mismo secreto compartido
// (header x-pos-secret), no con login de usuario.
//
// GET  ?sucursal=Florida        -> lista de pendientes para esa sucursal
// POST { ids: ["uuid", ...] }   -> las marca como aplicadas

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
  // Ver nota en recibir-corte-pos/index.ts sobre SERVICE_ROLE_JWT.
  const serviceKey = Deno.env.get("SERVICE_ROLE_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceKey);

  try {
    if (req.method === "GET") {
      const sucursal = new URL(req.url).searchParams.get("sucursal");
      if (!sucursal) return json({ error: "Falta el parametro sucursal" }, 400);

      const { data, error } = await adminClient
        .from("correcciones_pago_pendientes")
        .select("id, folio, turno_id, forma_pago_correcta, motivo, creada_por, creada_at")
        .eq("sucursal", sucursal)
        .eq("aplicada", false)
        .order("creada_at");

      if (error) return json({ error: error.message }, 400);
      return json({ pendientes: data ?? [] });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
      if (!ids.length) return json({ error: "Falta ids (array)" }, 400);

      const { error } = await adminClient
        .from("correcciones_pago_pendientes")
        .update({ aplicada: true, aplicada_at: new Date().toISOString() })
        .in("id", ids);

      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, aplicadas: ids.length });
    }

    return json({ error: "Metodo no permitido" }, 405);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
