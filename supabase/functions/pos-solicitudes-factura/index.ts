import { createClient } from "npm:@supabase/supabase-js@2";

// Canal de SOLICITUDES DE CORRECCIÓN DE FACTURA: el restaurante (Pescador POS)
// le pide a Oficina que cancele o sustituya una factura cuyo turno ya cerró.
// Oficina la atiende desde su panel (cancelar-cfdi / timbrar_sustituto) y el
// resultado le llega al POS por acciones_venta_pendientes ('cancelacion_directa');
// aquí solo vive el estado de la solicitud. Mismo patrón de auth que las demás:
// header x-pos-secret, el POS siempre inicia la conexión.
//
// GET  ?sucursal=Florida
//      -> { solicitudes } las pendientes + las resueltas que el POS aún no vio
// POST { accion: "crear", sucursal, folio, turno_id, uuid_fiscal, folio_pac,
//        tipo: "sustitucion"|"cancelacion", motivo_sat, datos_originales,
//        datos_corregidos, cambios, nota, solicitada_por }
// POST { accion: "visto", ids: [...] }         -> el POS ya vio la respuesta
// POST { accion: "retirar", id, retirada_por } -> el POS retira una pendiente

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
        .from("solicitudes_factura")
        .select(`id, folio, turno_id, tipo, motivo_sat, cambios, nota, solicitada_por, solicitada_at,
          estado, resuelta_at, resuelta_por, motivo_rechazo, visto_por_pos`)
        .eq("sucursal", sucursal)
        .or("estado.eq.pendiente,visto_por_pos.eq.false")
        .order("solicitada_at", { ascending: false });

      if (error) return json({ error: error.message }, 400);
      return json({ solicitudes: data ?? [] });
    }

    if (req.method !== "POST") return json({ error: "Metodo no permitido" }, 405);

    const body = await req.json();
    const accion: string = body?.accion;

    if (accion === "crear") {
      const { sucursal, folio, tipo } = body;
      if (!sucursal || !folio || !["sustitucion", "cancelacion"].includes(tipo)) {
        return json({ error: "Falta sucursal, folio o tipo invalido (sustitucion|cancelacion)" }, 400);
      }
      if (tipo === "cancelacion" && !["02", "03", "04"].includes(body?.motivo_sat)) {
        return json({ error: "Para solo cancelar hace falta motivo_sat 02, 03 o 04" }, 400);
      }
      if (tipo === "sustitucion" && !(Array.isArray(body?.cambios) && body.cambios.length > 0)) {
        return json({ error: "Una sustitucion debe traer al menos un cambio" }, 400);
      }

      const { data, error } = await adminClient
        .from("solicitudes_factura")
        .insert({
          sucursal,
          folio,
          turno_id: body?.turno_id ?? null,
          uuid_fiscal: body?.uuid_fiscal ?? null,
          folio_pac: body?.folio_pac ?? null,
          tipo,
          motivo_sat: tipo === "cancelacion" ? body.motivo_sat : "01",
          datos_originales: body?.datos_originales ?? {},
          datos_corregidos: body?.datos_corregidos ?? {},
          cambios: body?.cambios ?? [],
          nota: body?.nota ?? null,
          solicitada_por: body?.solicitada_por ?? null,
        })
        .select("id")
        .single();

      if (error) {
        // 23505 = índice único: ya hay una pendiente para este folio.
        if (error.code === "23505") {
          return json({ error: "Ya hay una solicitud pendiente para este folio." }, 409);
        }
        return json({ error: error.message }, 400);
      }
      return json({ ok: true, id: data.id });
    }

    if (accion === "visto") {
      const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
      if (!ids.length) return json({ ok: true });
      const { error } = await adminClient
        .from("solicitudes_factura")
        .update({ visto_por_pos: true })
        .in("id", ids)
        .neq("estado", "pendiente"); // una pendiente nunca se da por vista
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (accion === "retirar") {
      if (!body?.id) return json({ error: "Falta id" }, 400);
      const { error } = await adminClient
        .from("solicitudes_factura")
        .update({
          estado: "retirada",
          resuelta_at: new Date().toISOString(),
          resuelta_por: body?.retirada_por ?? null,
          visto_por_pos: true,
        })
        .eq("id", body.id)
        .eq("estado", "pendiente"); // si Oficina ya la atendió, no se retira
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "accion invalida (crear|visto|retirar)" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
