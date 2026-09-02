import { createClient } from "npm:@supabase/supabase-js@2";

// Cancela un CFDI ante el SAT DIRECTO desde Oficina, sin pasar por el POS
// local ni por el PIN de un cajero -- decision explicita del dueno,
// 2026-09-01: hasta ahora Oficina solo dejaba una SOLICITUD en
// acciones_venta_pendientes para que alguien en la sucursal la confirmara
// en Pescador POS con el dialogo DialogoCancelarFactura (ver
// src/facturacion/dialogo_acciones.py alla). Esto reemplaza eso por una
// cancelacion real e inmediata, con los 4 motivos SAT (01-04) y folio
// sustituto para el 01 -- mismas reglas que ya implementa facturacom.py en
// pescador-pos.
//
// OJO -- gap conocido: esto NO avisa de vuelta a la base local de Pescador
// POS / hotel-sistema, asi que su tabla `facturas` puede seguir marcando el
// folio como vigente hasta que se construya ese sync de regreso. El
// historial real de esta cancelacion vive en cfdi_cancelaciones.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const HOST = "https://api.factura.com";
const F_PLUGIN = "9d4095c8f7ed5785cb14c0e3b033eeb8252416ed";
const ENTIDADES = ["HOT", "PUE", "FLO"];
const MOTIVOS_VALIDOS = ["01", "02", "03", "04"];

function facturacomHeaders(apiKey: string, secretKey: string) {
  return {
    "Content-Type": "application/json",
    "F-PLUGIN": F_PLUGIN,
    "F-Api-Key": apiKey,
    "F-Secret-Key": secretKey,
  };
}

async function fcJson(resp: Response) {
  let data: any = {};
  try {
    data = await resp.json();
  } catch {
    throw new Error(`Factura.com [${resp.status}]: respuesta no-JSON (${await resp.text().catch(() => "")})`);
  }
  if (!resp.ok) {
    throw new Error(`Factura.com [${resp.status}]: ${data?.message || JSON.stringify(data)}`);
  }
  return data;
}

// Resuelve el UID interno de Factura.com (el que pide /cancel) a partir del
// UUID fiscal que ya tiene Oficina sincronizado -- así no hace falta que
// Pescador POS / hotel-sistema manden nada nuevo para poder cancelar lo que
// ya está sincronizado hoy.
async function resolverUidPorUuid(apiKey: string, secretKey: string, uuidFiscal: string): Promise<string> {
  const resp = await fetch(`${HOST}/v4/cfdi/uuid/${uuidFiscal}`, { headers: facturacomHeaders(apiKey, secretKey) });
  const data = await fcJson(resp);
  const uid = data?.Data?.UID || data?.data?.UID || data?.UID || data?.Data?.uid;
  if (!uid) {
    throw new Error(`Factura.com no regreso un UID para el UUID ${uuidFiscal}. Respuesta: ${JSON.stringify(data)}`);
  }
  return uid;
}

async function cancelarEnFacturaCom(
  apiKey: string, secretKey: string, cfdiUid: string, motivo: string, folioSustituto: string | null,
) {
  const body: Record<string, string> = { motivo };
  if (folioSustituto) body.folioSustituto = folioSustituto;
  const resp = await fetch(`${HOST}/v4/cfdi40/${cfdiUid}/cancel`, {
    method: "POST", headers: facturacomHeaders(apiKey, secretKey), body: JSON.stringify(body),
  });
  const data = await fcJson(resp);
  // Factura.com regresa 200 con {"response":"error"} cuando el SAT rechaza
  // la cancelacion (folioSustituto invalido, ya cancelado, etc.) -- fcJson
  // no lo detecta porque solo mira el status code.
  if (data?.response === "error") {
    throw new Error(data?.message || JSON.stringify(data));
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Metodo no permitido" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SERVICE_ROLE_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller) return json({ error: "Sesion invalida" }, 401);

    const { data: perfil } = await callerClient.from("perfiles").select("rol").eq("id", caller.id).single();
    if (!perfil || (perfil.rol !== "admin" && perfil.rol !== "oficinista")) {
      return json({ error: "No tienes permiso para cancelar facturas" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const {
      entidad, uuid_fiscal, motivo, folio_sustituto,
      sucursal, folio, turno_id,
    } = body ?? {};

    if (!entidad || !ENTIDADES.includes(entidad)) return json({ error: "entidad invalida (usa HOT, PUE o FLO)" }, 400);
    if (!uuid_fiscal) return json({ error: "uuid_fiscal es obligatorio" }, 400);
    if (!motivo || !MOTIVOS_VALIDOS.includes(motivo)) return json({ error: "motivo invalido (usa 01, 02, 03 o 04)" }, 400);
    if (motivo === "01" && !folio_sustituto) {
      return json({ error: "Con motivo 01 (sustitucion) es obligatorio folio_sustituto (el UUID fiscal del CFDI que lo reemplaza)" }, 400);
    }

    const db = createClient(supabaseUrl, serviceKey);
    const { data: cred } = await db.from("facturacom_credenciales").select("api_key, secret_key").eq("entidad", entidad).maybeSingle();
    if (!cred?.api_key || !cred?.secret_key) return json({ error: `Faltan las llaves de factura.com para ${entidad}.` }, 500);

    const cfdiUid = await resolverUidPorUuid(cred.api_key, cred.secret_key, uuid_fiscal);
    const resultado = await cancelarEnFacturaCom(cred.api_key, cred.secret_key, cfdiUid, motivo, folio_sustituto || null);

    const { error: insErr } = await db.from("cfdi_cancelaciones").insert({
      entidad, sucursal: sucursal ?? null, folio: folio ?? null, turno_id: turno_id ?? null,
      uuid_fiscal, cfdi_uid: cfdiUid, motivo, folio_sustituto: folio_sustituto ?? null,
      respuesta_factura_com: resultado, cancelado_por: caller.id,
    });
    if (insErr) {
      // Ya se cancelo ante el SAT -- eso no se puede deshacer. Si falla el
      // guardado local, se avisa clarito para que se registre a mano y NO
      // se reintente la cancelacion (ya no hay nada que cancelar).
      return json({
        ok: true,
        aviso: `Se cancelo ante el SAT pero no se pudo guardar el registro local: ${insErr.message}. No reintentes cancelar este folio -- ya esta cancelado.`,
        resultado,
      });
    }

    return json({ ok: true, resultado });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
