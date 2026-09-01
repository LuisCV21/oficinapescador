import { createClient } from "npm:@supabase/supabase-js@2";

// Facturacion Global generada desde Oficina (Fase 2) -- mismo flujo de 2
// pasos que ya usa Pescador POS / Hotel Sistema localmente (tab_global.py):
// se junta lo pendiente por forma de pago, se crea como BORRADOR en
// Factura.com (Draft=1, no consume folio ante el SAT), alguien lo revisa,
// y se timbra en un paso aparte. Puerta de entrada unica (accion=...) para
// las 4 operaciones, igual que el resto de los Edge Functions de este
// proyecto no usan carpeta compartida.
//
// Fuente de "que esta pendiente": cortes_caja.datos.pagos_detalle, que ya
// manda cada sucursal al cerrar turno (ver src/operaciones/caja.py en
// pescador-pos y src/oficina/sync_corte.py en hotel-sistema). Nunca se
// respeta la bandera "excluido" para una forma de pago que no sea
// efectivo -- esa bandera es para reportar efectivo aparte ante el SAT, y
// respetarla tambien para tarjeta/transferencia fue exactamente el bug que
// dejo $5,556 (Puebla) y $5,415 (Florida) sin facturar en agosto 2026 (ver
// el fix en pescador-pos/src/facturacion/tab_global.py::_excluir_efectivo_grupo).

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
const IVA_TASA = 0.16;
const ISH_TASA = 0.02; // Impuesto Sobre Hospedaje (Veracruz) -- solo Hotel

const KEYWORD: Record<string, string> = { HOT: "hotel", PUE: "puebla", FLO: "florida" };

// forma_pago cruda (como la manda cada sucursal, ya en minusculas) -> [clave SAT, nombre]
const FORMA_SAT: Record<string, [string, string]> = {
  credito: ["04", "Tarjeta de crédito"],
  tarjeta_credito: ["04", "Tarjeta de crédito"],
  debito: ["28", "Tarjeta de débito"],
  tarjeta_debito: ["28", "Tarjeta de débito"],
  transferencia: ["03", "Transferencia"],
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function facturacomHeaders(apiKey: string, secretKey: string) {
  return {
    "Content-Type": "application/json",
    "F-PLUGIN": F_PLUGIN,
    "F-Api-Key": apiKey,
    "F-Secret-Key": secretKey,
  };
}

async function fcCheck(resp: Response) {
  if (!resp.ok) {
    let msg: string;
    try {
      msg = JSON.stringify(await resp.json());
    } catch {
      msg = await resp.text();
    }
    throw new Error(`Factura.com [${resp.status}]: ${msg}`);
  }
}

async function buscarClientePorRfc(apiKey: string, secretKey: string, rfc: string) {
  const resp = await fetch(`${HOST}/v1/clients/${rfc}`, { headers: facturacomHeaders(apiKey, secretKey) });
  if (!resp.ok) return null;
  const data = await resp.json();
  if (data.status !== "success") return null;
  return data.Data;
}

async function buscarOCrearCliente(
  apiKey: string, secretKey: string,
  opts: { rfc: string; razonSocial: string; cp: string; regimen: string; usoCfdi: string },
): Promise<string> {
  const existente = await buscarClientePorRfc(apiKey, secretKey, opts.rfc);
  if (existente) return existente.UID;
  const resp = await fetch(`${HOST}/v1/clients/create`, {
    method: "POST",
    headers: facturacomHeaders(apiKey, secretKey),
    body: JSON.stringify({
      rfc: opts.rfc, razons: opts.razonSocial, codpos: opts.cp,
      email: "sin-correo@example.com", usocfdi: opts.usoCfdi, regimen: opts.regimen, pais: "MEX",
    }),
  });
  await fcCheck(resp);
  const data = await resp.json();
  if (data.status === "error" || !data.Data) {
    throw new Error(data.message || "Respuesta inesperada al crear el cliente en Factura.com.");
  }
  return data.Data.UID;
}

async function obtenerSerieFactura(apiKey: string, secretKey: string): Promise<number> {
  const resp = await fetch(`${HOST}/v4/series`, { headers: facturacomHeaders(apiKey, secretKey) });
  await fcCheck(resp);
  const data = await resp.json();
  const serie = (data.data || []).find((s: any) => s.SerieType === "factura" && s.SerieStatus === "Activa");
  if (!serie) throw new Error("La cuenta de Factura.com no tiene una serie activa de tipo 'factura'.");
  return serie.SerieID;
}

async function crearFactura(apiKey: string, secretKey: string, payload: unknown) {
  const resp = await fetch(`${HOST}/v4/cfdi40/create`, {
    method: "POST", headers: facturacomHeaders(apiKey, secretKey), body: JSON.stringify(payload),
  });
  await fcCheck(resp);
  return await resp.json();
}

async function timbrarBorrador(apiKey: string, secretKey: string, cfdiUid: string) {
  const resp = await fetch(`${HOST}/v4/cfdi40/${cfdiUid}/timbrarborrador`, {
    method: "POST", headers: facturacomHeaders(apiKey, secretKey),
  });
  await fcCheck(resp);
  return await resp.json();
}

async function eliminarBorrador(apiKey: string, secretKey: string, cfdiUid: string) {
  const resp = await fetch(`${HOST}/v4/drafts/${cfdiUid}/drop`, {
    method: "POST", headers: facturacomHeaders(apiKey, secretKey),
  });
  await fcCheck(resp);
  return await resp.json();
}

function folioRealDe(result: any): number | null {
  const folio = result?.INV?.Folio;
  return folio != null ? Number(folio) : null;
}

function periodoDe(mes: number, anio: number) {
  const inicio = `${anio}-${String(mes).padStart(2, "0")}-01`;
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const fin = `${anio}-${String(mes).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;
  return { inicio, fin };
}

type Pago = { folio: number; monto: number; fecha: string; cuenta: string | null; sat_code: string; sat_nombre: string };

async function candidatosPendientes(
  db: any, entidad: string, periodoInicio: string, periodoFin: string,
): Promise<Pago[]> {
  const keyword = KEYWORD[entidad];
  const { data: cortes, error } = await db
    .from("cortes_caja")
    .select("datos")
    .ilike("sucursal", `%${keyword}%`);
  if (error) throw new Error(`No se pudo leer cortes_caja: ${error.message}`);

  const candidatos: Pago[] = [];
  for (const corte of cortes ?? []) {
    const pagos = corte?.datos?.pagos_detalle ?? [];
    for (const p of pagos) {
      if (!p?.fecha || p?.folio == null) continue;
      const fechaYMD = String(p.fecha).slice(0, 10);
      if (fechaYMD < periodoInicio || fechaYMD > periodoFin) continue;
      const formaKey = String(p.forma_pago || "").toLowerCase();
      const sat = FORMA_SAT[formaKey];
      if (!sat) continue; // efectivo u otra forma no facturable en Global
      if (p.facturado) continue;
      // OJO: nunca se filtra por p.excluido aqui -- ver nota al inicio del
      // archivo, ese fue justo el bug de agosto 2026.
      candidatos.push({
        folio: Number(p.folio), monto: round2(Number(p.monto || 0)), fecha: p.fecha,
        cuenta: p.cuenta ?? null, sat_code: sat[0], sat_nombre: sat[1],
      });
    }
  }

  const { data: previas, error: errPrev } = await db
    .from("facturas_globales")
    .select("folios")
    .eq("entidad", entidad).eq("periodo_inicio", periodoInicio).eq("periodo_fin", periodoFin)
    .neq("estado", "cancelada");
  if (errPrev) throw new Error(`No se pudo leer facturas_globales: ${errPrev.message}`);
  const cubiertos = new Set<number>();
  for (const row of previas ?? []) {
    for (const f of row.folios ?? []) cubiertos.add(Number(f.folio));
  }
  return candidatos.filter((c) => !cubiertos.has(c.folio));
}

function agruparPorFormaPago(candidatos: Pago[], entidad: string) {
  const tasaTotal = entidad === "HOT" ? IVA_TASA + ISH_TASA : IVA_TASA;
  const grupos: Record<string, {
    sat_code: string; sat_nombre: string; folios: Pago[];
    subtotal: number; iva: number; ish: number; total: number;
  }> = {};
  for (const c of candidatos) {
    const g = (grupos[c.sat_code] ??= {
      sat_code: c.sat_code, sat_nombre: c.sat_nombre, folios: [],
      subtotal: 0, iva: 0, ish: 0, total: 0,
    });
    const subtotal = round2(c.monto / (1 + tasaTotal));
    const iva = entidad === "HOT" ? round2(subtotal * IVA_TASA) : round2(c.monto - subtotal);
    const ish = entidad === "HOT" ? round2(c.monto - subtotal - iva) : 0;
    g.folios.push(c);
    g.subtotal = round2(g.subtotal + subtotal);
    g.iva = round2(g.iva + iva);
    g.ish = round2(g.ish + ish);
    g.total = round2(g.total + c.monto);
  }
  return Object.values(grupos);
}

function construirConceptos(entidad: string, folios: Pago[]) {
  const tasaTotal = entidad === "HOT" ? IVA_TASA + ISH_TASA : IVA_TASA;
  const claveProdServ = entidad === "HOT" ? "90111800" : "90101501";
  const claveUnidad = entidad === "HOT" ? "E48" : "ACT";
  const descripcion = entidad === "HOT" ? "Servicio de hospedaje" : "Venta de alimentos y bebidas";
  return folios.map((f) => {
    const subtotal = round2(f.monto / (1 + tasaTotal));
    const iva = entidad === "HOT" ? round2(subtotal * IVA_TASA) : round2(f.monto - subtotal);
    const ish = entidad === "HOT" ? round2(f.monto - subtotal - iva) : 0;
    return {
      ClaveProdServ: claveProdServ, Cantidad: 1, ClaveUnidad: claveUnidad, Unidad: "Actividad",
      ValorUnitario: subtotal, Descripcion: descripcion, ObjetoImp: "02",
      Impuestos: {
        Traslados: [{ Base: subtotal, Impuesto: "002", TipoFactor: "Tasa", TasaOCuota: "0.16", Importe: iva }],
        Retenidos: [],
        Locales: entidad === "HOT" && ish
          ? [{ Base: subtotal, Impuesto: "ISH", TipoFactor: "Tasa", TasaOCuota: "0.02", Importe: ish }]
          : [],
      },
    };
  });
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
      return json({ error: "No tienes permiso para facturación Global" }, 403);
    }

    const db = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));
    const { accion, entidad, mes, anio, forma_pago, factura_global_id } = body ?? {};

    if (!entidad || !KEYWORD[entidad]) return json({ error: "entidad inválida (usa HOT, PUE o FLO)" }, 400);

    // ── pendientes: calcula lo que falta facturar por forma de pago ──────
    if (accion === "pendientes") {
      if (!mes || !anio) return json({ error: "mes y anio son obligatorios" }, 400);
      const { inicio, fin } = periodoDe(Number(mes), Number(anio));
      const candidatos = await candidatosPendientes(db, entidad, inicio, fin);
      const grupos = agruparPorFormaPago(candidatos, entidad);
      const { data: existentes } = await db
        .from("facturas_globales")
        .select("id, forma_pago, forma_nombre, subtotal, iva, total, estado, facturapi_id, uuid_fiscal, folio_cfdi, folios, fecha_creacion, fecha_timbrado")
        .eq("entidad", entidad).eq("periodo_inicio", inicio).eq("periodo_fin", fin)
        .neq("estado", "cancelada")
        .order("fecha_creacion", { ascending: true });
      return json({ periodo_inicio: inicio, periodo_fin: fin, grupos, existentes: existentes ?? [] });
    }

    // ── crear_borrador: crea el CFDI Draft=1 en Factura.com ───────────────
    if (accion === "crear_borrador") {
      if (!mes || !anio || !forma_pago) return json({ error: "mes, anio y forma_pago son obligatorios" }, 400);
      const { inicio, fin } = periodoDe(Number(mes), Number(anio));

      const candidatos = await candidatosPendientes(db, entidad, inicio, fin);
      const folios = candidatos.filter((c) => c.sat_code === forma_pago);
      if (!folios.length) {
        return json({ error: "No hay ventas pendientes para esa forma de pago en este periodo." }, 400);
      }

      const { data: cred } = await db.from("facturacom_credenciales").select("api_key, secret_key").eq("entidad", entidad).maybeSingle();
      if (!cred?.api_key || !cred?.secret_key) {
        return json({ error: `Faltan las llaves de factura.com para ${entidad} (Configuración → Facturación).` }, 500);
      }
      const { data: fiscal } = await db.from("entidades_fiscales").select("cp").eq("entidad", entidad).maybeSingle();
      if (!fiscal?.cp) {
        return json({ error: `Falta el código postal de facturación de ${entidad} (entidades_fiscales.cp).` }, 500);
      }

      const conceptos = construirConceptos(entidad, folios);
      const grupo = agruparPorFormaPago(folios, entidad)[0];

      const clienteUid = await buscarOCrearCliente(cred.api_key, cred.secret_key, {
        rfc: "XAXX010101000", razonSocial: "PUBLICO EN GENERAL", cp: fiscal.cp, regimen: "616", usoCfdi: "S01",
      });
      const serieId = await obtenerSerieFactura(cred.api_key, cred.secret_key);

      const payload = {
        Receptor: { UID: clienteUid },
        TipoDocumento: "factura",
        Draft: "1",
        InformacionGlobal: { Periodicidad: "04", Meses: String(mes).padStart(2, "0"), Año: String(anio) },
        Conceptos: conceptos,
        UsoCFDI: "S01",
        Serie: serieId,
        FormaPago: grupo.sat_code,
        MetodoPago: "PUE",
        Moneda: "MXN",
        LugarExpedicion: fiscal.cp,
        EnviarCorreo: false,
      };
      const result = await crearFactura(cred.api_key, cred.secret_key, payload);
      if (result?.response === "error") return json({ error: `${grupo.sat_nombre}: ${result.message || JSON.stringify(result)}` }, 502);
      const facturapiId = result?.invoice_uid || result?.UID || result?.Data?.UID || "";
      if (!facturapiId) return json({ error: `Factura.com no regresó un UID de borrador. Respuesta: ${JSON.stringify(result)}` }, 502);

      const { data: inserted, error: insErr } = await db.from("facturas_globales").insert({
        entidad, periodo_inicio: inicio, periodo_fin: fin,
        forma_pago: grupo.sat_code, forma_nombre: grupo.sat_nombre,
        subtotal: grupo.subtotal, iva: grupo.iva + grupo.ish, total: grupo.total,
        estado: "borrador", facturapi_id: facturapiId,
        folios: folios.map((f) => ({ folio: f.folio, monto: f.monto, fecha: f.fecha, cuenta: f.cuenta })),
        creado_por: caller.id,
      }).select().single();
      if (insErr) return json({ error: `Se creó el borrador en Factura.com (UID ${facturapiId}) pero no se pudo guardar localmente: ${insErr.message}. Avisa antes de reintentar -- puede quedar duplicado.` }, 500);

      return json({ ok: true, factura_global: inserted });
    }

    // ── timbrar: timbra ante el SAT un borrador ya creado ─────────────────
    if (accion === "timbrar") {
      if (!factura_global_id) return json({ error: "factura_global_id es obligatorio" }, 400);
      const { data: fg } = await db.from("facturas_globales").select("*").eq("id", factura_global_id).single();
      if (!fg) return json({ error: "No se encontró esa factura Global." }, 404);
      if (fg.estado !== "borrador") return json({ error: `Esta Global ya está en estado '${fg.estado}', no se puede timbrar de nuevo.` }, 400);

      const { data: cred } = await db.from("facturacom_credenciales").select("api_key, secret_key").eq("entidad", fg.entidad).maybeSingle();
      if (!cred?.api_key || !cred?.secret_key) return json({ error: `Faltan las llaves de factura.com para ${fg.entidad}.` }, 500);

      const result = await timbrarBorrador(cred.api_key, cred.secret_key, fg.facturapi_id);
      if (result?.response === "error") return json({ error: result.message || JSON.stringify(result) }, 502);

      const uuidFiscal = result?.UUID || "";
      const folioCfdi = folioRealDe(result);
      const { data: updated, error: updErr } = await db.from("facturas_globales").update({
        estado: "timbrada", uuid_fiscal: uuidFiscal, folio_cfdi: folioCfdi, fecha_timbrado: new Date().toISOString(),
      }).eq("id", factura_global_id).select().single();
      if (updErr) {
        return json({
          error: `Se timbró ante el SAT (UUID ${uuidFiscal}) pero no se pudo actualizar localmente: ${updErr.message}. `
            + `NO reintentes timbrar -- ya existe. Avisa para corregir el registro a mano.`,
        }, 500);
      }
      return json({ ok: true, factura_global: updated });
    }

    // ── descartar: borra un borrador que nunca se timbró ──────────────────
    if (accion === "descartar") {
      if (!factura_global_id) return json({ error: "factura_global_id es obligatorio" }, 400);
      const { data: fg } = await db.from("facturas_globales").select("*").eq("id", factura_global_id).single();
      if (!fg) return json({ error: "No se encontró esa factura Global." }, 404);
      if (fg.estado !== "borrador") return json({ error: "Solo se puede descartar un borrador (no una ya timbrada)." }, 400);

      const { data: cred } = await db.from("facturacom_credenciales").select("api_key, secret_key").eq("entidad", fg.entidad).maybeSingle();
      let aviso = "";
      if (cred?.api_key && cred?.secret_key && fg.facturapi_id) {
        try {
          await eliminarBorrador(cred.api_key, cred.secret_key, fg.facturapi_id);
        } catch (e) {
          aviso = ` (aviso: no se pudo confirmar el borrado en Factura.com -- ${e} -- probablemente ya lo habían borrado ahí a mano)`;
        }
      }
      await db.from("facturas_globales").delete().eq("id", factura_global_id);
      return json({ ok: true, mensaje: `Borrador descartado.${aviso}` });
    }

    return json({ error: `accion desconocida: ${accion}` }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
