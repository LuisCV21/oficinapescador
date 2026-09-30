import { createClient } from "npm:@supabase/supabase-js@2";

// Canal para que Pescador POS / Hotel jalen la solicitud de "reinicio de mes"
// que Oficina dejo pendiente para su sucursal, y reporten el resultado. Mismo
// patron que pos-correcciones-anterior: el POS siempre inicia la conexion y se
// autentica con el secreto compartido (header x-pos-secret).
//
// GET  ?sucursal=Florida
//        -> { pendiente: {...} | null }   (solo una solicitud vigente; las que
//           ya vencieron se marcan 'caducada' aqui mismo)
// POST { id, estado: "ejecutada" | "error", ejecutada_por?, resumen?, error? }
//        -> cierra la solicitud. Solo se puede cerrar una que siga 'pendiente'.

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
  const db = createClient(supabaseUrl, serviceKey);

  try {
    if (req.method === "GET") {
      const sucursal = new URL(req.url).searchParams.get("sucursal");
      if (!sucursal) return json({ error: "Falta el parametro sucursal" }, 400);

      // Caducar las vencidas de esta sucursal.
      await db.from("reinicios_mes_pendientes")
        .update({ estado: "caducada" })
        .eq("sucursal", sucursal).eq("estado", "pendiente")
        .lt("expira_at", new Date().toISOString());

      const { data, error } = await db
        .from("reinicios_mes_pendientes")
        .select("id, sucursal, periodo, turno_inicial, creada_por, creada_at, expira_at")
        .eq("sucursal", sucursal).eq("estado", "pendiente")
        .order("creada_at", { ascending: false })
        .limit(1);
      if (error) return json({ error: error.message }, 400);
      return json({ pendiente: data && data.length ? data[0] : null });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const id: string | undefined = body?.id;
      const estado: string | undefined = body?.estado;
      if (!id || !["ejecutada", "error"].includes(String(estado))) {
        return json({ error: "Falta id o estado invalido (ejecutada | error)" }, 400);
      }
      const { data, error } = await db
        .from("reinicios_mes_pendientes")
        .update({
          estado,
          ejecutada_at: new Date().toISOString(),
          ejecutada_por: body?.ejecutada_por ? String(body.ejecutada_por).slice(0, 120) : null,
          resumen: body?.resumen ?? null,
          error: estado === "error" ? String(body?.error ?? "").slice(0, 1000) : null,
        })
        .eq("id", id).eq("estado", "pendiente")
        .select("id");
      if (error) return json({ error: error.message }, 400);
      if (!data || !data.length) return json({ error: "La solicitud ya no esta pendiente" }, 409);
      return json({ ok: true });
    }

    return json({ error: "Metodo no permitido" }, 405);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
