import { createClient } from "npm:@supabase/supabase-js@2";

// Recibe el corte de turno que manda Pescador POS (sistema de escritorio
// aparte) al cerrar turno cada dia, y lo guarda en cortes_caja. Se autentica
// con un secreto compartido (header x-pos-secret), no con login de usuario,
// porque quien llama es la app de escritorio, no alguien con sesion aqui.

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

  try {
    const secretoEsperado = Deno.env.get("POS_SHARED_SECRET");
    const secretoRecibido = req.headers.get("x-pos-secret");
    if (!secretoEsperado || secretoRecibido !== secretoEsperado) {
      return json({ error: "No autorizado" }, 401);
    }

    const body = await req.json();
    const { turno_id, sucursal, apertura, cierre, total_ventas, cuadre } = body ?? {};
    if (!turno_id || !sucursal || !apertura) {
      return json({ error: "turno_id, sucursal y apertura son obligatorios" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { error } = await adminClient.from("cortes_caja").upsert(
      {
        turno_id,
        sucursal,
        apertura,
        cierre: cierre ?? null,
        total_ventas: total_ventas ?? 0,
        diferencia_cuadre: cuadre?.diferencia_cuadre ?? null,
        datos: body,
      },
      { onConflict: "sucursal,turno_id" },
    );

    if (error) return json({ error: error.message }, 400);

    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
