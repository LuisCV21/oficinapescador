// Timbra en factura.com (produccion) la nomina semanal de una sucursal, a
// partir de lo que ya se captura en el modulo de Nomina y asistencia
// (nomina_periodos/nomina_lineas). Reemplaza al modulo de prueba
// timbrar-nomina-prueba (ese sigue existiendo, aparte, apuntando a sandbox).
//
// Por empleado, solo se timbra si ya tiene CURP + RFC + NSS capturados en
// Recursos Humanos (eso lo exige el SAT, no se puede inventar). Los que no
// los tengan se regresan como "incompletos" con el detalle de que falta,
// sin llamar a factura.com por ellos -- el resto de la nomina si se timbra.
//
// El domicilio que pide factura.com para dar de alta al empleado usa el
// domicilio fiscal de la propia empresa (constante por sucursal abajo) en
// vez del domicilio personal del empleado, porque ese campo casi nunca esta
// capturado en Recursos Humanos y factura.com lo pide como texto simple
// (no hay forma segura de partir un domicilio libre en calle/colonia/cp).
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

function facturacomHeaders(apiKey: string, secretKey: string) {
  return {
    "Content-Type": "application/json",
    "F-PLUGIN": F_PLUGIN,
    "F-Api-Key": apiKey,
    "F-Secret-Key": secretKey,
  };
}

const ENT_LABEL: Record<string, string> = { FLO: "Florida", PUE: "Puebla", HOT: "Hotel" };

// Domicilio fiscal de la empresa que factura cada sucursal (ver memoria
// project_facturacom_nomina_setup). Se usa como domicilio del empleado ante
// factura.com porque el domicilio personal no esta capturado de forma
// estructurada en Recursos Humanos.
const DOMICILIO_EMPRESA: Record<string, {
  calle: string; no_ext: string; colonia: string; cp: string; municipio: string; estado: string;
}> = {
  FLO: { calle: "CARRETERA POZA RICA CAZONES", no_ext: "SN", colonia: "LA VICTORIA KM 47", cp: "93523", municipio: "Papantla", estado: "Veracruz - VER" },
  PUE: { calle: "AVENIDA PUEBLA", no_ext: "505", colonia: "PALMA SOLA", cp: "93320", municipio: "Poza Rica de Hidalgo", estado: "Veracruz - VER" },
  HOT: { calle: "AVENIDA PUEBLA", no_ext: "505", colonia: "PALMA SOLA", cp: "93320", municipio: "Poza Rica de Hidalgo", estado: "Veracruz - VER" },
};

const TIPO_CONTRATO_SAT: Record<string, string> = { indeterminado: "01", obra: "02", prueba: "05" };

// Subsidio para el empleo, decreto DOF 31/12/2025 vigente en 2026: cuota fija
// mensual (sin tabla escalonada), completa si el trabajador no rebasa el
// limite mensual, prorrateada a la semana igual que en el front-end
// (index.html, calcularSubsidioSemanal) para que el ISR guardado en
// nomina_lineas y el subsidio que se manda al CFDI salgan consistentes entre
// si. La elegibilidad se checa contra el SALARIO DIARIO BASE, no el subtotal
// variable de la semana -- ver la nota en index.html/calcularSubsidioSemanal
// con el caso real que confirma esto.
const SUBSIDIO_EMPLEO_MENSUAL_2026 = 536.22;
const SUBSIDIO_EMPLEO_LIMITE_MENSUAL_2026 = 11492.66;
function calcularSubsidioSemanal(salarioDiario: number): number {
  const salario = Number(salarioDiario) || 0;
  const limiteDiario = SUBSIDIO_EMPLEO_LIMITE_MENSUAL_2026 / 30.4;
  if (salario <= 0 || salario > limiteDiario) return 0;
  return Math.round(((SUBSIDIO_EMPLEO_MENSUAL_2026 / 30.4) * 7) * 100) / 100;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    // SUPABASE_SERVICE_ROLE_KEY es una variable reservada que inyecta la
    // plataforma sola; en este proyecto la esta poblando con la llave nueva
    // formato "sb_secret_..." en vez del JWT clasico de service_role, y con
    // esa el cliente no obtiene permisos reales (permission denied al leer
    // nomina_periodos). Se usa en su lugar SERVICE_ROLE_JWT, un secret propio
    // con el JWT clasico de service_role, que si funciona.
    const serviceKey = Deno.env.get("SERVICE_ROLE_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller) return json({ error: "Sesión inválida" }, 401);

    const { data: callerPerfil } = await callerClient.from("perfiles").select("rol").eq("id", caller.id).single();
    if (!callerPerfil || (callerPerfil.rol !== "admin" && callerPerfil.rol !== "oficinista")) {
      return json({ error: "No tienes permiso para timbrar nómina" }, 403);
    }

    const { periodo_id, linea_ids } = await req.json().catch(() => ({}));
    if (!periodo_id) return json({ error: "Falta periodo_id" }, 400);

    const db = createClient(supabaseUrl, serviceKey);

    const { data: periodo, error: periodoErr } = await db.from("nomina_periodos").select("*").eq("id", periodo_id).single();
    if (periodoErr || !periodo) return json({ error: "No se encontró el periodo de nómina" }, 404);

    const ent: string = periodo.entidad;
    const apiKey = Deno.env.get(`FACTURACOM_API_KEY_${ent}`);
    const secretKey = Deno.env.get(`FACTURACOM_SECRET_KEY_${ent}`);
    const serie = Deno.env.get(`FACTURACOM_SERIE_${ent}`);
    const patronal = Deno.env.get(`FACTURACOM_PATRONAL_${ent}`);
    if (!apiKey || !secretKey || !serie || !patronal) {
      return json({ error: `Faltan las llaves de factura.com configuradas para ${ENT_LABEL[ent] || ent}` }, 500);
    }
    const headers = facturacomHeaders(apiKey, secretKey);

    // linea_ids es opcional: si viene, solo se timbran esas lineas del periodo
    // (usado por el "Solo esta" / seleccion parcial de la vista previa, para
    // poder probar con un empleado antes de mandar el resto).
    let lineasQuery = db
      .from("nomina_lineas")
      .select("*, empleados(id,nombre,curp,rfc,nss,salario_diario,puesto_id,fecha_ingreso,tipo_contrato,facturacom_uid)")
      .eq("periodo_id", periodo_id);
    if (Array.isArray(linea_ids) && linea_ids.length) lineasQuery = lineasQuery.in("id", linea_ids);
    const { data: lineas, error: lineasErr } = await lineasQuery;
    if (lineasErr) return json({ error: lineasErr.message }, 500);
    if (!lineas || !lineas.length) return json({ error: "Esta nómina no tiene empleados capturados" }, 400);

    const { data: puestos } = await db.from("puestos").select("id,nombre");
    const puestoNombre = (id: string | null) => puestos?.find((p) => p.id === id)?.nombre || "EMPLEADO";

    // 1. Separar quién está listo (CURP+RFC+NSS) de quién no.
    const listos: typeof lineas = [];
    const resultados: Array<{ linea_id: string; empleado: string; status: string; mensaje: string }> = [];
    for (const l of lineas) {
      const e = l.empleados as any;
      if (!e) continue;
      const faltan: string[] = [];
      if (!e.curp?.trim()) faltan.push("CURP");
      if (!e.rfc?.trim()) faltan.push("RFC");
      if (!e.nss?.trim()) faltan.push("NSS");
      if (!e.fecha_ingreso) faltan.push("fecha de ingreso");
      if (Number(l.dias_pagados) <= 0) faltan.push("días pagados en 0");
      if (faltan.length) {
        resultados.push({ linea_id: l.id, empleado: e.nombre, status: "datos_incompletos", mensaje: "Falta: " + faltan.join(", ") });
      } else {
        listos.push(l);
      }
    }

    await db.from("nomina_lineas").update({ facturacom_status: "datos_incompletos" }).in(
      "id",
      resultados.map((r) => r.linea_id),
    );

    if (!listos.length) {
      return json({ ok: false, timbrados: 0, resultados });
    }

    // 2. Grupo de la sucursal en factura.com (se crea una sola vez y se reusa).
    let grupoUid: string;
    const { data: grupoExistente } = await db.from("facturacom_grupos").select("grupo_uid").eq("entidad", ent).maybeSingle();
    if (grupoExistente) {
      grupoUid = grupoExistente.grupo_uid;
    } else {
      const grupoRes = await fetch(`${HOST}/payroll/employee/group/create`, {
        method: "POST", headers, body: JSON.stringify({ grupo: `Oficina Pescador ${ENT_LABEL[ent] || ent}` }),
      });
      const grupoData = await grupoRes.json();
      if (grupoData.response !== "success") {
        return json({ error: "No se pudo crear el grupo de nómina en factura.com", detalle: grupoData }, 502);
      }
      grupoUid = grupoData.uid;
      await db.from("facturacom_grupos").insert({ entidad: ent, grupo_uid: grupoUid });
    }

    // 3. Dar de alta en factura.com a los empleados listos que aún no tengan uid.
    const dom = DOMICILIO_EMPRESA[ent];
    for (const l of listos) {
      const e = l.empleados as any;
      if (e.facturacom_uid) continue;
      const partes = String(e.nombre).trim().split(/\s+/);
      const empleadoRes = await fetch(`${HOST}/payroll/employee/create`, {
        method: "POST", headers, body: JSON.stringify({
          grupo: grupoUid,
          no_empleado: e.id.slice(0, 8),
          nombre: partes[0] || e.nombre,
          paterno: partes[1] || "",
          materno: partes.slice(2).join(" ") || "",
          metodo_pago: "03",
          periodo: "04",
          regimen: "02",
          puesto: puestoNombre(e.puesto_id),
          departamento: ENT_LABEL[ent] || ent,
          curp: e.curp,
          imss: e.nss,
          rfc: e.rfc,
          calle: dom.calle, colonia: dom.colonia, no_ext: dom.no_ext, cp: dom.cp, municipio: dom.municipio, estado: dom.estado,
          tipo_contrato: TIPO_CONTRATO_SAT[e.tipo_contrato] || "01",
          asimilados: "0",
          sindicalizado: "No",
          entidad_emite: "VER",
          tipo_jornada: "01",
          patronal,
          cuota_diaria: String(e.salario_diario || 0),
          salario: String(e.salario_diario || 0),
          riesgo: "2",
          inicio: e.fecha_ingreso,
        }),
      });
      const empleadoData = await empleadoRes.json();
      if (empleadoData.response !== "success") {
        resultados.push({ linea_id: l.id, empleado: e.nombre, status: "error", mensaje: "No se pudo registrar el empleado en factura.com: " + JSON.stringify(empleadoData) });
        continue;
      }
      e.facturacom_uid = empleadoData.data.uid;
      await db.from("empleados").update({ facturacom_uid: e.facturacom_uid }).eq("id", e.id);
    }

    const listosConUid = listos.filter((l) => (l.empleados as any).facturacom_uid && !resultados.some((r) => r.linea_id === l.id));
    if (!listosConUid.length) return json({ ok: false, timbrados: 0, resultados });

    // 4. Armar y timbrar la nómina con FechaFromAPI (evita el error de
    // desfase de reloj del servidor, ver memoria project_facturacom_nomina_sandbox_fecha).
    const fechaFromApi = new Date().toISOString().slice(0, 19);
    const registros = listosConUid.map((l) => {
      const e = l.empleados as any;
      const salario = Number(l.salario_diario) || 0;
      const diasPagados = Number(l.dias_pagados) || 0;
      const sueldo = salario * diasPagados;
      const prima = l.trabajo_domingo ? salario * 0.25 : 0;
      const subsidio = calcularSubsidioSemanal(salario);
      const percepciones = [{ tipo: "001", clave: "001", descripcion: "Sueldos, salarios rayas y jornales", exento: "0", gravado: sueldo.toFixed(2) }];
      if (prima > 0) percepciones.push({ tipo: "020", clave: "020", descripcion: "Prima dominical", exento: "0", gravado: prima.toFixed(2) });
      const deducciones = [];
      if (Number(l.retencion_isr) > 0) deducciones.push({ tipo: "002", clave: "002", descripcion: "ISR", importe: Number(l.retencion_isr).toFixed(2) });
      if (Number(l.retencion_imss) > 0) deducciones.push({ tipo: "001", clave: "001", descripcion: "Seguridad social", importe: Number(l.retencion_imss).toFixed(2) });
      return {
        data: { id: e.facturacom_uid, nombre: e.nombre, puesto: puestoNombre(e.puesto_id), dias: diasPagados },
        percepciones,
        deducciones,
        otrospagos: [{
          tipo: "002", clave: "002", descripcion: "Subsidio al empleo", importe: subsidio.toFixed(2),
          SubsidioAlEmpleo: { SubsidioCausado: subsidio.toFixed(2) },
        }],
      };
    });

    const nominaRes = await fetch(`${HOST}/payroll/create`, {
      method: "POST", headers, body: JSON.stringify({
        grupo: grupoUid,
        fecha_pago: periodo.fecha_pago || periodo.semana_fin,
        num_dias: 7,
        inicial: periodo.semana_inicio,
        final: periodo.semana_fin,
        tipo_nomina: "O",
        descripcion: `Nómina ${ENT_LABEL[ent] || ent} ${periodo.semana_inicio} a ${periodo.semana_fin}`,
        serie: Number(serie),
        concepto: "Pago de nómina",
        identificador: `OFICINA-${periodo_id}-${Date.now()}`,
        version_cfdi: "4.0",
        FechaFromAPI: fechaFromApi,
        registros,
      }),
    });
    const nominaData = await nominaRes.json();
    if (nominaData.response !== "success") {
      for (const l of listosConUid) {
        resultados.push({ linea_id: l.id, empleado: (l.empleados as any).nombre, status: "error", mensaje: "factura.com rechazó la nómina: " + JSON.stringify(nominaData) });
      }
      return json({ ok: false, timbrados: 0, resultados });
    }

    // El timbrado es asíncrono, se espera un momento y se consulta el estatus final.
    await new Promise((r) => setTimeout(r, 6000));
    const statusRes = await fetch(`${HOST}/payroll/${nominaData.uid}/view`, { headers });
    const statusData = await statusRes.json();
    const registrosStatus: any[] = statusData?.data?.registros || [];

    let timbrados = 0;
    for (const l of listosConUid) {
      const e = l.empleados as any;
      const reg = registrosStatus.find((r) => r.data?.id === e.facturacom_uid) || registrosStatus.find((r) => r.data?.nombre === e.nombre);
      const timbrada = reg?.status_timbre === "timbrada";
      if (timbrada) timbrados++;
      const status = timbrada ? "timbrada" : "error";
      const mensaje = timbrada ? "Timbrada correctamente" : (reg?.mensaje || "No se confirmó el timbrado, revisa en factura.com");
      resultados.push({ linea_id: l.id, empleado: e.nombre, status, mensaje });
      await db.from("nomina_lineas").update({
        facturacom_status: status,
        facturacom_mensaje: mensaje,
        facturacom_uuid: reg?.uuid || null,
      }).eq("id", l.id);
    }
    await db.from("nomina_periodos").update({ timbrado_en: new Date().toISOString() }).eq("id", periodo_id);

    return json({ ok: timbrados > 0, timbrados, total: listosConUid.length, resultados, nomina_uid: nominaData.uid });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error inesperado" }, 500);
  }
});
