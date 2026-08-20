// Cancela un CFDI de nomina ya timbrado por error y lo sustituye por uno
// correcto, para la MISMA linea/periodo/empleado. Pensado para corregir
// timbrados que salieron mal (ej. el bug del subsidio al empleo duplicado
// que se corrigio en timbrar-nomina/index.ts -- ver ese commit) sin tener
// que hacerlo a mano en el panel de factura.com.
//
// Flujo, en dos pasos posibles por si algo tarda o falla a medio camino:
//   1. Si la linea no tiene ya un sustituto en curso, se timbra uno nuevo
//      (con los mismos datos de nomina_lineas, que ya estan correctos --
//      solo el CFDI original quedo mal) y se guarda su uid en
//      facturacom_sustituto_*. Esto NO cancela el original todavia.
//   2. Cuando factura.com confirma que el sustituto ya quedo timbrado, se
//      cancela el original (motivo 02 -- se probo motivo 01 en sandbox
//      primero, pero /payroll/create no tiene forma de ponerle al sustituto
//      el nodo CfdiRelacionados que motivo 01 exige, factura.com siempre lo
//      rechaza; motivo 02 si funciona, confirmado en sandbox) y se actualiza
//      la linea para que quede apuntando al CFDI nuevo. Si el sustituto
//      tarda en confirmarse, hay que volver a llamar a esta funcion despues
//      -- no vuelve a timbrar otro sustituto, retoma desde el que ya quedo
//      guardado.
import { createClient } from "npm:@supabase/supabase-js@2";

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

const F_PLUGIN = "9d4095c8f7ed5785cb14c0e3b033eeb8252416ed";
const HOST = "https://api.factura.com";
const ENT_LABEL: Record<string, string> = { FLO: "Florida", PUE: "Puebla", HOT: "Hotel" };

function facturacomHeaders(apiKey: string, secretKey: string) {
  return {
    "Content-Type": "application/json",
    "F-PLUGIN": F_PLUGIN,
    "F-Api-Key": apiKey,
    "F-Secret-Key": secretKey,
  };
}

// Mismo calculo que timbrar-nomina/index.ts (subsidio + ISR causado) para
// poder reconstruir el registro corregido -- ver ese archivo para el porque.
const SUBSIDIO_EMPLEO_MENSUAL_2026 = 536.22;
const SUBSIDIO_EMPLEO_LIMITE_MENSUAL_2026 = 11492.66;
function calcularSubsidioSemanal(salarioDiario: number): number {
  const salario = Number(salarioDiario) || 0;
  const limiteDiario = SUBSIDIO_EMPLEO_LIMITE_MENSUAL_2026 / 30.4;
  if (salario <= 0 || salario > limiteDiario) return 0;
  return Math.round(((SUBSIDIO_EMPLEO_MENSUAL_2026 / 30.4) * 7) * 100) / 100;
}
const ISR_TARIFA_SEMANAL_2026 = [
  { limInf: 0.01, limSup: 194.46, cuota: 0, pct: 1.92 },
  { limInf: 194.47, limSup: 1650.67, cuota: 3.71, pct: 6.40 },
  { limInf: 1650.68, limSup: 2900.87, cuota: 96.95, pct: 10.88 },
  { limInf: 2900.88, limSup: 3372.11, cuota: 232.96, pct: 16.00 },
  { limInf: 3372.12, limSup: 4037.32, cuota: 308.35, pct: 17.92 },
  { limInf: 4037.33, limSup: 8142.75, cuota: 427.56, pct: 21.36 },
  { limInf: 8142.76, limSup: 12834.08, cuota: 1304.45, pct: 23.52 },
  { limInf: 12834.09, limSup: 24502.45, cuota: 2407.86, pct: 30.00 },
  { limInf: 24502.46, limSup: 32669.91, cuota: 5908.35, pct: 32.00 },
  { limInf: 32669.92, limSup: 98009.66, cuota: 8521.94, pct: 34.00 },
  { limInf: 98009.67, limSup: Infinity, cuota: 30737.49, pct: 35.00 },
];
function calcularIsrCausadoSemanal(baseGravable: number): number {
  const base = Number(baseGravable) || 0;
  if (base <= 0) return 0;
  const b = ISR_TARIFA_SEMANAL_2026.find((r) => base >= r.limInf && base <= r.limSup) ||
    ISR_TARIFA_SEMANAL_2026[ISR_TARIFA_SEMANAL_2026.length - 1];
  return Math.round((b.cuota + (base - b.limInf) * (b.pct / 100)) * 100) / 100;
}

function buscarRegistro(registros: any[], facturacomUid: string, nombre: string) {
  return registros.find((r) => r.employee_uid === facturacomUid) ||
    registros.find((r) => r.data?.id === facturacomUid) ||
    registros.find((r) => r.data?.nombre === nombre);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SERVICE_ROLE_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller) return json({ error: "Sesión inválida" }, 401);

    const { data: callerPerfil } = await callerClient.from("perfiles").select("rol").eq("id", caller.id).single();
    if (!callerPerfil || (callerPerfil.rol !== "admin" && callerPerfil.rol !== "oficinista")) {
      return json({ error: "No tienes permiso para corregir nómina" }, 403);
    }

    const { linea_id } = await req.json().catch(() => ({}));
    if (!linea_id) return json({ error: "Falta linea_id" }, 400);

    const db = createClient(supabaseUrl, serviceKey);

    const { data: l } = await db.from("nomina_lineas")
      .select("*, empleados(id,nombre,facturacom_uid,puesto_id,salario_diario)")
      .eq("id", linea_id).single();
    if (!l) return json({ error: "No se encontró la línea de nómina" }, 404);
    if (l.facturacom_status !== "timbrada" && !l.facturacom_sustituto_nomina_uid) {
      return json({ error: "Esta línea no está timbrada (o ya se canceló), no hay nada que corregir." }, 400);
    }
    if (!l.facturacom_uuid || !l.facturacom_nomina_uid) {
      return json({ error: "Esta línea no tiene un CFDI de nómina original registrado, no se puede sustituir." }, 400);
    }

    const e = l.empleados as any;
    const { data: periodo } = await db.from("nomina_periodos").select("*").eq("id", l.periodo_id).single();
    if (!periodo) return json({ error: "No se encontró el periodo de esta línea" }, 404);
    const ent: string = periodo.entidad;

    const { data: cred } = await db.from("facturacom_credenciales").select("*").eq("entidad", ent).maybeSingle();
    if (!cred?.api_key || !cred?.secret_key) {
      return json({ error: `Faltan las llaves de factura.com para ${ENT_LABEL[ent] || ent}` }, 500);
    }
    const headers = facturacomHeaders(cred.api_key, cred.secret_key);

    // Paso 1: si aun no hay sustituto en curso, se timbra uno nuevo con los
    // mismos datos ya correctos de esta linea. El original NO se toca todavia.
    let sustitutoNominaUid: string = l.facturacom_sustituto_nomina_uid;
    if (!sustitutoNominaUid) {
      const { data: grupoExistente } = await db.from("facturacom_grupos").select("grupo_uid").eq("entidad", ent).maybeSingle();
      if (!grupoExistente) return json({ error: "No se encontró el grupo de nómina de factura.com para esta sucursal" }, 500);
      const { data: puestos } = await db.from("puestos").select("id,nombre");
      const puestoNombre = (id: string | null) => puestos?.find((p) => p.id === id)?.nombre || "EMPLEADO";

      const salario = Number(l.salario_diario) || 0;
      const diasPagados = Number(l.dias_pagados) || 0;
      const sueldo = salario * diasPagados;
      const prima = l.trabajo_domingo ? salario * 0.25 : 0;
      const subsidioCalculado = calcularSubsidioSemanal(salario);
      const isrCausado = calcularIsrCausadoSemanal(sueldo + prima);
      const subsidioEfectivo = Math.max(0, Math.round((subsidioCalculado - isrCausado) * 100) / 100);
      const percepciones = [{ tipo: "001", clave: "001", descripcion: "Sueldos, salarios rayas y jornales", exento: "0", gravado: sueldo.toFixed(2) }];
      if (prima > 0) percepciones.push({ tipo: "020", clave: "020", descripcion: "Prima dominical", exento: "0", gravado: prima.toFixed(2) });
      const deducciones = [];
      if (Number(l.retencion_isr) > 0) deducciones.push({ tipo: "002", clave: "002", descripcion: "ISR", importe: Number(l.retencion_isr).toFixed(2) });
      if (Number(l.retencion_imss) > 0) deducciones.push({ tipo: "001", clave: "001", descripcion: "Seguridad social", importe: Number(l.retencion_imss).toFixed(2) });

      const fechaFromApi = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "America/Mexico_City",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      }).format(new Date()).replace(" ", "T");

      const nominaRes = await fetch(`${HOST}/payroll/create`, {
        method: "POST", headers, body: JSON.stringify({
          grupo: grupoExistente.grupo_uid,
          fecha_pago: periodo.fecha_pago || periodo.semana_fin,
          num_dias: 7,
          inicial: periodo.semana_inicio,
          final: periodo.semana_fin,
          tipo_nomina: "O",
          descripcion: `Corrección — sustituye folio ${l.facturacom_uuid} — ${ENT_LABEL[ent] || ent} ${periodo.semana_inicio} a ${periodo.semana_fin}`,
          serie: Number(cred.serie),
          concepto: "Pago de nómina (corrección)",
          identificador: `OFICINA-SUSTITUTO-${linea_id}-${Date.now()}`,
          version_cfdi: "4.0",
          FechaFromAPI: fechaFromApi,
          registros: [{
            data: { id: e.facturacom_uid, nombre: e.nombre, puesto: puestoNombre(e.puesto_id), dias: diasPagados },
            percepciones,
            deducciones,
            otrospagos: subsidioCalculado > 0 ? [{
              tipo: "002", clave: "002", descripcion: "Subsidio al empleo", importe: subsidioEfectivo.toFixed(2),
              SubsidioAlEmpleo: { SubsidioCausado: subsidioCalculado.toFixed(2) },
            }] : [],
          }],
        }),
      });
      const nominaData = await nominaRes.json();
      if (nominaData.response !== "success") {
        return json({ error: "factura.com rechazó el CFDI sustituto", detalle: nominaData }, 502);
      }
      sustitutoNominaUid = nominaData.uid;
      await db.from("nomina_lineas").update({ facturacom_sustituto_nomina_uid: sustitutoNominaUid }).eq("id", linea_id);
      // Le da tiempo a factura.com de confirmar el timbrado antes de checar
      // (igual que timbrar-nomina) -- si no alcanza, un segundo clic retoma
      // desde aqui sin volver a timbrar otro sustituto.
      await new Promise((r) => setTimeout(r, 15000));
    }

    // Paso 2: revisa si el sustituto ya quedó timbrado; si no, se detiene
    // aquí y hay que volver a llamar a esta función más tarde.
    const statusRes = await fetch(`${HOST}/payroll/${sustitutoNominaUid}/view`, { headers });
    const statusData = await statusRes.json();
    const registros: any[] = statusData?.data?.registros || [];
    const reg = buscarRegistro(registros, e.facturacom_uid, e.nombre);
    const timbrada = reg?.status_timbre === "timbrada";
    if (!timbrada) {
      const ESPERANDO = ["en fila", "pendiente", "espera", "en proceso", "procesando"];
      const rechazada = reg?.status_timbre && !ESPERANDO.includes(reg.status_timbre);
      if (rechazada) {
        return json({ ok: false, status: "error", mensaje: `factura.com rechazó el CFDI sustituto: ${reg?.mensaje || reg?.status_timbre}` });
      }
      return json({
        ok: false, status: "pendiente",
        mensaje: "El CFDI sustituto todavía no se confirma en factura.com. El original sigue vigente y NO se ha cancelado. Vuelve a intentar en unos minutos.",
      });
    }
    const nuevoItemUid = reg.uid;
    const nuevoUuid = reg.uuid;

    // uid de item del CFDI ORIGINAL (el que se va a cancelar). Si ya se
    // guardó al timbrarlo se usa directo; si es un timbrado viejo (de antes
    // de que se empezara a guardar) se busca en vivo en su lote.
    let originalItemUid: string | null = l.facturacom_item_uid;
    if (!originalItemUid) {
      const origRes = await fetch(`${HOST}/payroll/${l.facturacom_nomina_uid}/view`, { headers });
      const origData = await origRes.json();
      const origRegistros: any[] = origData?.data?.registros || [];
      const origReg = origRegistros.find((r) => r.uuid === l.facturacom_uuid) || buscarRegistro(origRegistros, e.facturacom_uid, e.nombre);
      originalItemUid = origReg?.uid || null;
    }
    if (!originalItemUid) {
      return json({
        ok: false, status: "error",
        mensaje: "No se pudo determinar el identificador del CFDI original para cancelarlo. El sustituto ya quedó timbrado " +
          `(folio ${nuevoUuid}) pero el original (folio ${l.facturacom_uuid}) sigue sin cancelar — hazlo manualmente en factura.com.`,
      });
    }

    // Motivo 02 (sin relación), no 01: se probó en sandbox y /payroll/create
    // no tiene forma (documentada ni encontrada probando variantes de
    // parámetro) de ponerle al sustituto el nodo CfdiRelacionados que motivo
    // 01 exige -- con motivo 01 factura.com siempre rechaza la cancelación
    // ("el CFDI que está enviando como sustituto no contiene relaciones").
    // Motivo 02 sí funciona sin depender de eso; la trazabilidad hacia el
    // folio original queda solo en la "descripcion" del sustituto y en
    // facturacom_uuid_anterior de esta misma tabla, no como relación formal
    // del CFDI.
    const cancelRes = await fetch(`${HOST}/payroll/${originalItemUid}/item/cancel`, {
      method: "POST", headers, body: JSON.stringify({ motivo: "02" }),
    });
    const cancelData = await cancelRes.json();
    if (cancelData.response !== "success") {
      return json({
        ok: false, status: "error",
        mensaje: `El sustituto ya quedó timbrado (folio ${nuevoUuid}) pero factura.com rechazó la cancelación del original: ` +
          JSON.stringify(cancelData),
      });
    }

    await db.from("nomina_lineas").update({
      facturacom_uuid_anterior: l.facturacom_uuid,
      facturacom_uuid: nuevoUuid,
      facturacom_item_uid: nuevoItemUid,
      facturacom_nomina_uid: sustitutoNominaUid,
      facturacom_status: "timbrada",
      facturacom_mensaje: `Corregido el ${new Date().toISOString().slice(0, 10)}: se canceló el folio ${l.facturacom_uuid} y se sustituyó por este.`,
      facturacom_sustituido_en: new Date().toISOString(),
      facturacom_sustituto_nomina_uid: null,
      facturacom_sustituto_item_uid: null,
      facturacom_sustituto_uuid: null,
    }).eq("id", linea_id);

    return json({ ok: true, status: "sustituido", folio_anterior: l.facturacom_uuid, folio_nuevo: nuevoUuid });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error inesperado" }, 500);
  }
});
