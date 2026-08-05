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
    const { turno_id, sucursal, apertura, cierre, total_ventas, cuadre, pdf_base64, pdf_filename } = body ?? {};
    if (!turno_id || !sucursal || !apertura) {
      return json({ error: "turno_id, sucursal y apertura son obligatorios" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Subir el PDF al bucket privado (si vino) -- se guarda solo la ruta,
    // no una URL publica; el frontend pide una signed URL al vuelo.
    let pdf_path: string | null = null;
    if (pdf_base64 && pdf_filename) {
      try {
        const bytes = Uint8Array.from(atob(pdf_base64), (c) => c.charCodeAt(0));
        const path = `${sucursal}/${turno_id}_${pdf_filename}`;
        const { error: upErr } = await adminClient.storage
          .from("cortes-pdf")
          .upload(path, bytes, { contentType: "application/pdf", upsert: true });
        if (!upErr) pdf_path = path;
      } catch {
        // Si falla la subida del PDF no se pierde el resto del corte.
      }
    }

    // No guardar el PDF (pesado) dentro de la columna jsonb `datos`.
    const { pdf_base64: _omit, ...datosSinPdf } = body;

    const { error } = await adminClient.from("cortes_caja").upsert(
      {
        turno_id,
        sucursal,
        apertura,
        cierre: cierre ?? null,
        total_ventas: total_ventas ?? 0,
        diferencia_cuadre: cuadre?.diferencia_cuadre ?? null,
        pdf_path,
        datos: datosSinPdf,
      },
      { onConflict: "sucursal,turno_id" },
    );

    if (error) return json({ error: error.message }, 400);

    return json({ ok: true, pdf_path });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
