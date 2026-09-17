import { createClient } from "npm:@supabase/supabase-js@2";

// Trae el PDF ya timbrado de un CFDI para verlo/descargarlo desde Oficina
// (botón "👁 Ver factura" en Ventas del mes y en Folios de pago del detalle
// de corte) -- pedido del dueño, 17-sept-2026: antes solo se podía cancelar
// la factura desde aquí, no verla. Mismo mecanismo de resolución (UUID
// fiscal -> UID interno de Factura.com) que ya usa cancelar-cfdi, y el mismo
// endpoint GET /v4/cfdi40/{uid}/pdf que ya usa Pescador POS/hotel-sistema
// para imprimir (ver descargar_pdf en src/facturacion/facturacom.py allá).
//
// A diferencia del resto de las funciones de este proyecto, esta regresa el
// PDF tal cual (application/pdf), no JSON -- el navegador lo pide con fetch()
// + Authorization y arma un blob para mostrarlo en un <iframe> o descargarlo.

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

function facturacomHeaders(apiKey: string, secretKey: string) {
  return {
    "Content-Type": "application/json",
    "F-PLUGIN": F_PLUGIN,
    "F-Api-Key": apiKey,
    "F-Secret-Key": secretKey,
  };
}

// Igual que en cancelar-cfdi: Oficina solo tiene el UUID fiscal sincronizado
// del corte, pero el endpoint del PDF pide el UID interno de Factura.com.
async function resolverUidPorUuid(apiKey: string, secretKey: string, uuidFiscal: string): Promise<string> {
  const resp = await fetch(`${HOST}/v4/cfdi/uuid/${uuidFiscal}`, { headers: facturacomHeaders(apiKey, secretKey) });
  let data: any = {};
  try {
    data = await resp.json();
  } catch {
    throw new Error(`Factura.com [${resp.status}]: respuesta no-JSON al buscar el UUID`);
  }
  if (!resp.ok) throw new Error(`Factura.com [${resp.status}]: ${data?.message || JSON.stringify(data)}`);
  const uid = data?.Data?.UID || data?.data?.UID || data?.UID || data?.Data?.uid;
  if (!uid) throw new Error(`Factura.com no regresó un UID para el UUID ${uuidFiscal}.`);
  return uid;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SERVICE_ROLE_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller) return json({ error: "Sesión inválida" }, 401);

    const { data: perfil } = await callerClient.from("perfiles").select("rol").eq("id", caller.id).single();
    if (!perfil || (perfil.rol !== "admin" && perfil.rol !== "oficinista")) {
      return json({ error: "No tienes permiso para ver facturas" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const { entidad, uuid_fiscal } = body ?? {};
    if (!entidad || !ENTIDADES.includes(entidad)) return json({ error: "entidad inválida (usa HOT, PUE o FLO)" }, 400);
    if (!uuid_fiscal) return json({ error: "uuid_fiscal es obligatorio" }, 400);

    const db = createClient(supabaseUrl, serviceKey);
    const { data: cred } = await db.from("facturacom_credenciales").select("api_key, secret_key").eq("entidad", entidad).maybeSingle();
    if (!cred?.api_key || !cred?.secret_key) return json({ error: `Faltan las llaves de factura.com para ${entidad}.` }, 500);

    const cfdiUid = await resolverUidPorUuid(cred.api_key, cred.secret_key, uuid_fiscal);

    const pdfResp = await fetch(`${HOST}/v4/cfdi40/${cfdiUid}/pdf`, { headers: facturacomHeaders(cred.api_key, cred.secret_key) });
    if (!pdfResp.ok) {
      const detalle = await pdfResp.text().catch(() => "");
      return json({ error: `Factura.com [${pdfResp.status}] al pedir el PDF: ${detalle}` }, 502);
    }

    return new Response(pdfResp.body, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/pdf" },
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
