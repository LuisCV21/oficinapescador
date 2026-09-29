import { createClient } from "npm:@supabase/supabase-js@2";

// Verifica contra Factura.com el estado real de las autofacturas que las
// sucursales ya mandaron en su corte (cortes_caja.datos.cuentas[].autofactura,
// ver src/operaciones/caja.py en pescador-pos) -- mismo mecanismo que ya usa
// Pescador POS en tab_autofacturas.py (GET /v4/autofacturacion/folio/{folio}
// + GET /v4/cfdi/uuid/{uuid} para el folio real), pero corriendo desde
// Oficina para que Kenya/administración no dependan de que alguien en la
// sucursal corra el checador local y reenvíe el corte (reportado sept-2026:
// las autofacturas no se reflejaban en Oficina).
//
// A diferencia de recibir-corte-pos (que sobreescribe el corte completo tal
// cual lo manda el POS), aquí solo se toca el sub-objeto `autofactura` de
// cada cuenta dentro del jsonb `datos` -- el resto del corte no se modifica.

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
const KEYWORD: Record<string, string> = { HOT: "hotel", PUE: "puebla", FLO: "florida" };

function facturacomHeaders(apiKey: string, secretKey: string) {
  return {
    "Content-Type": "application/json",
    "F-PLUGIN": F_PLUGIN,
    "F-Api-Key": apiKey,
    "F-Secret-Key": secretKey,
  };
}

async function buscarOrdenAutofactura(apiKey: string, secretKey: string, folio: string) {
  const resp = await fetch(`${HOST}/v4/autofacturacion/folio/${folio}`, {
    headers: facturacomHeaders(apiKey, secretKey),
  });
  if (!resp.ok) throw new Error(`Factura.com [${resp.status}] al consultar folio ${folio}`);
  const data = await resp.json();
  return data?.data || null;
}

async function consultarCfdiPorUuid(apiKey: string, secretKey: string, uuid: string) {
  const resp = await fetch(`${HOST}/v4/cfdi/uuid/${uuid}`, {
    headers: facturacomHeaders(apiKey, secretKey),
  });
  if (!resp.ok) throw new Error(`Factura.com [${resp.status}] al consultar UUID ${uuid}`);
  return await resp.json();
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
      return json({ error: "No tienes permiso para verificar autofacturas" }, 403);
    }

    const db = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));
    const { entidad } = body ?? {};
    if (!entidad || !KEYWORD[entidad]) return json({ error: "entidad inválida (usa HOT, PUE o FLO)" }, 400);

    const { data: cred } = await db.from("facturacom_credenciales")
      .select("api_key, secret_key").eq("entidad", entidad).maybeSingle();
    if (!cred?.api_key || !cred?.secret_key) {
      return json({ error: `Faltan las llaves de factura.com para ${entidad} (Configuración → Facturación).` }, 500);
    }

    const { data: cortes, error } = await db.from("cortes_caja")
      .select("id, datos").ilike("sucursal", `%${KEYWORD[entidad]}%`);
    if (error) return json({ error: `No se pudo leer cortes_caja: ${error.message}` }, 500);

    let revisadas = 0, nuevas_facturadas = 0, folios_completados = 0;
    let descubiertas = 0, ligadas = 0;
    const errores: string[] = [];
    const cortesSucios = new Set<string>();

    // ── Fase 1: descubrir órdenes que el POS nunca mandó ────────────────
    // Si la sucursal corre una versión vieja del POS, o el corte no trae la
    // autofactura de una cuenta, la orden existe en Factura.com pero Oficina
    // no se entera. Aquí se recorren los folios AF1, AF2, ... directo en
    // Factura.com y las que no estén en ningún corte se ligan a la venta
    // (mismo día + mismo importe no-efectivo) o, si no hay una sola
    // coincidencia, se guardan en datos.autofacturas_huerfanas del corte de
    // ese día para que al menos se vean y cuenten como ya facturadas.
    const NO_FACTURABLE = ["efectivo", "ado", "vales"];
    const conocidos = new Set<string>();
    for (const corte of cortes ?? []) {
      const d = corte?.datos ?? {};
      for (const q of [...(d.cuentas ?? []), ...(d.pagos_detalle ?? [])]) {
        if (q?.autofactura?.folio) conocidos.add(String(q.autofactura.folio));
      }
      for (const a of [...(d.autofacturas_detalle ?? []), ...(d.autofacturas_huerfanas ?? [])]) {
        if (a?.folio) conocidos.add(String(a.folio));
      }
    }
    if (KEYWORD[entidad] !== "hotel") {
      let fallosSeguidos = 0;
      for (let n = 1; n <= 300 && fallosSeguidos < 6; n++) {
        const folioAF = `AF${n}`;
        if (conocidos.has(folioAF)) { fallosSeguidos = 0; continue; }
        let orden;
        try {
          orden = await buscarOrdenAutofactura(cred.api_key, cred.secret_key, folioAF);
        } catch (_e) {
          fallosSeguidos++;
          continue;
        }
        if (!orden) { fallosSeguidos++; continue; }
        fallosSeguidos = 0;

        const yaFact = ["si", "sí", "yes", "1"].includes(String(orden.facturado ?? "").trim().toLowerCase());
        const uuidFiscal = (orden.uuid || "").trim();
        let folioPac: string | null = null;
        if (yaFact && uuidFiscal) {
          try {
            const cfdi = await consultarCfdiPorUuid(cred.api_key, cred.secret_key, uuidFiscal);
            folioPac = cfdi?.data?.Folio || null;
          } catch (e) {
            errores.push(`${folioAF}: se autofacturó pero no se pudo recuperar el folio (${e})`);
          }
        }
        const af: any = {
          folio: folioAF, importe: Number(orden.importe), fecha: String(orden.fecha || "").slice(0, 10),
          vencimiento: orden.vencimiento ?? null, facturado: yaFact,
          uuid_fiscal: uuidFiscal || null, folio_pac: folioPac, estado: "subida", error_msg: null,
          origen: "factura.com",
        };
        descubiertas++;

        // Cuentas candidatas: mismo día, sin autofactura, y cuya parte
        // no-efectivo suma exactamente el importe de la orden.
        const candidatas: { corte: any; cuenta: any }[] = [];
        for (const corte of cortes ?? []) {
          for (const cuenta of corte?.datos?.cuentas ?? []) {
            if (cuenta?.autofactura) continue;
            const pagos = cuenta?.pagos_detalle ?? [];
            if (!pagos.some((p: any) => String(p?.fecha ?? "").slice(0, 10) === af.fecha)) continue;
            const importe = Object.entries(cuenta?.pagos_por_forma ?? {})
              .filter(([forma]) => !NO_FACTURABLE.includes(String(forma).trim().toLowerCase()))
              .reduce((s, [, m]) => s + Number(m || 0), 0);
            if (Math.abs(importe - af.importe) < 0.015) candidatas.push({ corte, cuenta });
          }
        }
        // Si hay varias del mismo día e importe, se desempata con la forma
        // de pago de la orden (04 crédito, 28 débito, 03 transferencia; 99 =
        // mixto, no desempata): dos cuentas de $440, una con débito y otra
        // con crédito, ya no quedan como ambiguas.
        const SAT_DE: Record<string, string> = {
          credito: "04", tarjeta_credito: "04", debito: "28", tarjeta_debito: "28", transferencia: "03",
        };
        const formaOrden = String(orden.formaDePago ?? "").trim();
        let elegidas = candidatas;
        if (candidatas.length > 1 && formaOrden && formaOrden !== "99") {
          const porForma = candidatas.filter(({ cuenta }) => {
            const formas = Object.keys(cuenta?.pagos_por_forma ?? {})
              .map((f) => f.trim().toLowerCase())
              .filter((f) => !NO_FACTURABLE.includes(f));
            return formas.length === 1 && SAT_DE[formas[0]] === formaOrden;
          });
          if (porForma.length === 1) elegidas = porForma;
        }
        if (elegidas.length === 1) {
          elegidas[0].cuenta.autofactura = af;
          cortesSucios.add(elegidas[0].corte.id);
          ligadas++;
        } else {
          const corteDia = (cortes ?? []).find((c: any) =>
            String(c?.datos?.apertura ?? "").slice(0, 10) === af.fecha);
          if (corteDia) {
            af.motivo_sin_liga = candidatas.length ? "ambigua" : "sin_coincidencia";
            (corteDia.datos.autofacturas_huerfanas ??= []).push(af);
            cortesSucios.add(corteDia.id);
          } else {
            errores.push(`${folioAF}: no hay corte del ${af.fecha} donde guardarla`);
          }
        }
      }
    }

    for (const corte of cortes ?? []) {
      // Restaurantes (Florida/Puebla): la autofactura viaja en cuentas[].
      // Hotel: no tiene "cuentas", viaja en pagos_detalle[] -- ver
      // src/oficina/sync_corte.py en cada repo. Las huérfanas (Fase 1) se
      // revisan igual: se envuelven para que `.autofactura` apunte a ellas.
      const portadores = [
        ...(corte?.datos?.cuentas ?? []), ...(corte?.datos?.pagos_detalle ?? []),
        ...(corte?.datos?.autofacturas_huerfanas ?? []).map((h: any) => ({ autofactura: h })),
      ];
      let cambio = cortesSucios.has(corte.id);

      for (const portador of portadores) {
        const af = portador?.autofactura;
        if (!af) continue;
        // Igual criterio que actualizar_estado_autofacturas en pescador-pos:
        // revisa tanto lo pendiente como lo ya marcado facturado sin folio_pac
        // guardado (para completarlo también) -- el hotel nunca guarda
        // folio_pac localmente, así que esas quedan a completar aquí siempre
        // que Oficina todavía no lo tenga en su propio snapshot.
        if (af.facturado && af.folio_pac) continue;
        revisadas++;

        let orden;
        try {
          orden = await buscarOrdenAutofactura(cred.api_key, cred.secret_key, af.folio);
        } catch (e) {
          errores.push(`${af.folio}: ${e}`);
          continue;
        }
        const yaFacturado = orden && ["si", "sí", "yes", "1"]
          .includes(String(orden.facturado ?? "").trim().toLowerCase());
        if (!yaFacturado) continue;

        const uuidFiscal = (orden.uuid || "").trim();
        let folioPac: string | null = null;
        if (uuidFiscal) {
          try {
            const cfdi = await consultarCfdiPorUuid(cred.api_key, cred.secret_key, uuidFiscal);
            folioPac = cfdi?.data?.Folio || null;
          } catch (e) {
            errores.push(`${af.folio}: se autofacturó pero no se pudo recuperar el folio (${e})`);
          }
        }

        if (af.facturado) folios_completados++; else nuevas_facturadas++;
        af.facturado = true;
        af.uuid_fiscal = uuidFiscal || null;
        af.folio_pac = folioPac ?? af.folio_pac ?? null;
        cambio = true;
      }

      if (cambio) {
        const { error: updErr } = await db.from("cortes_caja")
          .update({ datos: corte.datos }).eq("id", corte.id);
        if (updErr) errores.push(`corte ${corte.id}: no se pudo guardar (${updErr.message})`);
      }
    }

    return json({ revisadas, nuevas_facturadas, folios_completados, descubiertas, ligadas, errores });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
