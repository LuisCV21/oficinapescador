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

// CFDI vigentes de Factura.com indexados por NumOrder (= folio de la orden de
// autofactura, ej. "AF24"). A veces el portal emite la factura del cliente pero
// la consulta /autofacturacion/folio/AF24 sigue diciendo facturado="No" sin UUID
// (caso real: orden AF24 de Florida, factura AF 4 del 30-sep): sin esto la venta
// se quedaba "pendiente" y la Global la volvia a facturar.
async function cfdiVigentesPorOrden(apiKey: string, secretKey: string, desdeYmd: string): Promise<Map<string, { uuid: string; folio: string }>> {
  const mapa = new Map<string, { uuid: string; folio: string }>();
  const hoyD = new Date();
  let anio = Number(desdeYmd.slice(0, 4)), mes = Number(desdeYmd.slice(5, 7));
  while (anio < hoyD.getUTCFullYear() || (anio === hoyD.getUTCFullYear() && mes <= hoyD.getUTCMonth() + 1)) {
    let pag = 1, ultima = 1;
    do {
      const resp = await fetch(`${HOST}/v4/cfdi40/list?month=${mes}&year=${anio}&per_page=100&page=${pag}`, {
        headers: facturacomHeaders(apiKey, secretKey),
      });
      if (!resp.ok) throw new Error(`Factura.com [${resp.status}] al listar CFDI ${anio}-${mes}`);
      const d = await resp.json();
      ultima = Number(d?.last_page || 1);
      for (const x of d?.data ?? []) {
        const orden = String(x?.NumOrder ?? "").trim();
        if (orden && x?.Status === "enviada" && x?.UUID) mapa.set(orden, { uuid: String(x.UUID), folio: String(x.Folio ?? "") });
      }
      pag++;
    } while (pag <= ultima);
    mes++;
    if (mes > 12) { mes = 1; anio++; }
  }
  return mapa;
}

// Solo se trabaja de septiembre-2026 en adelante.
const FECHA_MIN = "2026-09-01";
const CORTE_DESDE = "2026-08-31"; // un turno que abrió el 31 puede cobrar ya en septiembre
// Tiempo máximo de trabajo antes de responder con lo que se alcanzó a revisar
// (el límite de la función es ~150 s; así el botón nunca se queda colgado).
const PRESUPUESTO_MS = 100_000;

function sumarDias(ymd: string, dias: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Corre `fn` sobre cada elemento con hasta `n` en paralelo.
async function enParalelo<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const it = items[i++];
      await fn(it);
    }
  }));
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

    // Solo septiembre-2026 en adelante: lo anterior ya no se revisa ni se
    // descubre (pedido del dueño, 29-sept-2026) -- además de innecesario,
    // leer y reescribir todo el historial de cortes hacía muy lenta la
    // verificación.
    const { data: cortes, error } = await db.from("cortes_caja")
      .select("id, datos").ilike("sucursal", `%${KEYWORD[entidad]}%`).gte("apertura", CORTE_DESDE);
    if (error) return json({ error: `No se pudo leer cortes_caja: ${error.message}` }, 500);

    let revisadas = 0, nuevas_facturadas = 0, folios_completados = 0;
    let descubiertas = 0, ligadas = 0;
    let incompleto = false;
    const errores: string[] = [];
    const cortesSucios = new Set<string>();
    const t0 = Date.now();
    const sinTiempo = () => Date.now() - t0 > PRESUPUESTO_MS;

    // ── Fase 1: descubrir órdenes que el POS nunca mandó ────────────────
    // Si la sucursal corre una versión vieja del POS, o el corte no trae la
    // autofactura de una cuenta, la orden existe en Factura.com pero Oficina
    // no se entera. Se consultan en Factura.com solo los folios AF que caben
    // entre la primera autofactura conocida de septiembre y la siguiente al
    // último folio conocido, y las que no estén en ningún corte se ligan a la
    // venta (mismo día + mismo importe no-efectivo + misma forma de pago) o,
    // si no hay una sola coincidencia, se guardan en
    // datos.autofacturas_huerfanas del corte de ese día.
    const NO_FACTURABLE = ["efectivo", "ado", "vales"];
    const conocidos = new Set<string>();
    const numerosSep: number[] = [];
    for (const corte of cortes ?? []) {
      const d = corte?.datos ?? {};
      const lista = [
        ...(d.cuentas ?? []).map((q: any) => q?.autofactura),
        ...(d.pagos_detalle ?? []).map((q: any) => q?.autofactura),
        ...(d.autofacturas_detalle ?? []), ...(d.autofacturas_huerfanas ?? []),
      ];
      for (const a of lista) {
        if (!a?.folio) continue;
        conocidos.add(String(a.folio));
        const m = /^AF(\d+)$/.exec(String(a.folio));
        if (m && String(a.fecha ?? "") >= FECHA_MIN) numerosSep.push(Number(m[1]));
      }
    }

    const SAT_DE: Record<string, string> = {
      credito: "04", tarjeta_credito: "04", debito: "28", tarjeta_debito: "28", transferencia: "03",
    };
    const procesarOrdenNueva = async (folioAF: string) => {
      let orden;
      try {
        orden = await buscarOrdenAutofactura(cred.api_key, cred.secret_key, folioAF);
      } catch (_e) {
        return false;
      }
      if (!orden) return false;
      const fecha = String(orden.fecha || "").slice(0, 10);
      if (fecha < FECHA_MIN) return true; // existe, pero es anterior a septiembre: se ignora

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
        folio: folioAF, importe: Number(orden.importe), fecha,
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
      // Si hay varias del mismo día e importe, se desempata con la forma de
      // pago de la orden (04 crédito, 28 débito, 03 transferencia; 99 = mixto,
      // no desempata).
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
      return true;
    };

    if (KEYWORD[entidad] !== "hotel") {
      const desde = numerosSep.length ? Math.min(...numerosSep) : 1;
      const hasta = numerosSep.length ? Math.max(...numerosSep) : 0;
      // Huecos entre el primero y el último conocido de septiembre.
      const huecos: string[] = [];
      for (let n = desde; n <= hasta; n++) if (!conocidos.has(`AF${n}`)) huecos.push(`AF${n}`);
      await enParalelo(huecos, 8, async (f) => { if (!sinTiempo()) await procesarOrdenNueva(f); });
      // Folios posteriores al último conocido: de 4 en 4 hasta que ninguno exista.
      let n = hasta + 1;
      for (let tanda = 0; tanda < 15 && !sinTiempo(); tanda++) {
        const lote = [0, 1, 2, 3].map((i) => `AF${n + i}`).filter((f) => !conocidos.has(f));
        const halladas = await Promise.all(lote.map((f) => procesarOrdenNueva(f)));
        n += 4;
        if (!halladas.some(Boolean)) break;
      }
    }

    // ── Fase 2: refrescar las que siguen pendientes ─────────────────────
    // Igual criterio que actualizar_estado_autofacturas en pescador-pos:
    // revisa lo pendiente y lo marcado facturado sin folio_pac guardado (para
    // completarlo). Restaurantes (Florida/Puebla): la autofactura viaja en
    // cuentas[]; hotel: en pagos_detalle[]; las huérfanas (Fase 1) se envuelven
    // para que `.autofactura` apunte a ellas.
    const hoy = new Date().toISOString().slice(0, 10);
    const tareas: { corte: any; af: any }[] = [];
    for (const corte of cortes ?? []) {
      const portadores = [
        ...(corte?.datos?.cuentas ?? []), ...(corte?.datos?.pagos_detalle ?? []),
        ...(corte?.datos?.autofacturas_huerfanas ?? []).map((h: any) => ({ autofactura: h })),
      ];
      for (const portador of portadores) {
        const af = portador?.autofactura;
        if (!af || !af.folio) continue;
        if (String(af.fecha ?? "") < FECHA_MIN) continue;
        if (af.facturado && af.folio_pac && af.uuid_fiscal) continue; // completa también las que no traen UUID
        // Una autofactura pendiente que ya venció hace días no la va a usar
        // nadie: no se sigue consultando en cada verificación.
        if (!af.facturado && af.vencimiento && hoy > sumarDias(String(af.vencimiento).slice(0, 10), 7)) continue;
        tareas.push({ corte, af });
      }
    }
    let porOrden = new Map<string, { uuid: string; folio: string }>();
    if (tareas.some((t) => !t.af.facturado)) {
      try {
        porOrden = await cfdiVigentesPorOrden(cred.api_key, cred.secret_key, FECHA_MIN);
      } catch (e) {
        errores.push(`No se pudo listar los CFDI de Factura.com para cruzar por orden: ${e}`);
      }
    }
    await enParalelo(tareas, 8, async ({ corte, af }) => {
      if (sinTiempo()) { incompleto = true; return; }
      revisadas++;
      let orden;
      try {
        orden = await buscarOrdenAutofactura(cred.api_key, cred.secret_key, af.folio);
      } catch (e) {
        errores.push(`${af.folio}: ${e}`);
        return;
      }
      const yaFacturado = orden && ["si", "sí", "yes", "1"]
        .includes(String(orden.facturado ?? "").trim().toLowerCase());
      if (!yaFacturado) {
        // La orden dice "No", pero puede existir un CFDI vigente ligado a ella.
        const porNum = porOrden.get(String(af.folio));
        if (!porNum) return;
        if (af.facturado) folios_completados++; else nuevas_facturadas++;
        af.facturado = true;
        af.uuid_fiscal = porNum.uuid;
        af.folio_pac = porNum.folio || af.folio_pac || null;
        cortesSucios.add(corte.id);
        return;
      }

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
      cortesSucios.add(corte.id);
    });

    // Guarda solo los cortes que cambiaron.
    const porId = new Map<string, any>((cortes ?? []).map((c: any) => [c.id, c]));
    await enParalelo([...cortesSucios], 6, async (id) => {
      const corte = porId.get(id);
      if (!corte) return;
      const { error: updErr } = await db.from("cortes_caja").update({ datos: corte.datos }).eq("id", id);
      if (updErr) errores.push(`corte ${id}: no se pudo guardar (${updErr.message})`);
    });

    return json({ revisadas, nuevas_facturadas, folios_completados, descubiertas, ligadas, incompleto, errores });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
