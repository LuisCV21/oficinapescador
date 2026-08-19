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

// Salario diario integrado (SBC) para dar de alta al empleado en
// factura.com -- mismo calculo que ya usa index.html/calcularFactorIntegracion
// para el IMSS retenido: integra aguinaldo (15 dias) y la prima vacacional de
// los dias de vacaciones que le tocan por antiguedad (tabla "vacaciones
// dignas" vigente desde 2023).
function diasVacacionesLFT(anios: number): number {
  const tabla: Record<number, number> = { 1: 12, 2: 14, 3: 16, 4: 18, 5: 20 };
  if (tabla[anios]) return tabla[anios];
  if (anios <= 10) return 22;
  if (anios <= 15) return 24;
  if (anios <= 20) return 26;
  if (anios <= 25) return 28;
  return 30;
}
function calcularSalarioIntegrado(salarioDiario: number, fechaIngreso: string | null): number {
  const salario = Number(salarioDiario) || 0;
  if (!fechaIngreso) return salario;
  const ingreso = new Date(fechaIngreso + "T12:00:00");
  const hoy = new Date();
  let anios = hoy.getFullYear() - ingreso.getFullYear();
  const aniversarioEsteAnio = new Date(hoy.getFullYear(), ingreso.getMonth(), ingreso.getDate());
  if (hoy < aniversarioEsteAnio) anios--;
  const aniosTabla = Math.max(1, anios);
  const dias = diasVacacionesLFT(aniosTabla);
  const factor = (365 + 15 + dias * 0.25) / 365;
  return Math.round(salario * factor * 10000) / 10000;
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

    const { periodo_id, linea_ids, verificar_linea_id } = await req.json().catch(() => ({}));

    const db = createClient(supabaseUrl, serviceKey);

    // Solo re-consulta el estatus de un timbrado ya enviado, sin crear nada
    // nuevo en factura.com -- para cuando quedo "pendiente" y se quiere ver
    // si ya se confirmo, sin arriesgar timbrar dos veces a la misma persona.
    if (verificar_linea_id) {
      const { data: l } = await db.from("nomina_lineas").select("*, empleados(id,nombre,facturacom_uid)").eq("id", verificar_linea_id).single();
      if (!l) return json({ error: "No se encontró la línea de nómina" }, 404);
      if (!l.facturacom_nomina_uid) return json({ error: "Esta línea no tiene un timbrado enviado para verificar" }, 400);
      const { data: periodoV } = await db.from("nomina_periodos").select("entidad").eq("id", l.periodo_id).single();
      const entV: string = periodoV?.entidad || "";
      const { data: credV } = await db.from("facturacom_credenciales").select("*").eq("entidad", entV).maybeSingle();
      if (!credV?.api_key || !credV?.secret_key) return json({ error: `Faltan las llaves de factura.com para ${ENT_LABEL[entV] || entV}` }, 500);
      const headersV = facturacomHeaders(credV.api_key, credV.secret_key);
      const statusResV = await fetch(`${HOST}/payroll/${l.facturacom_nomina_uid}/view`, { headers: headersV });
      const statusDataV = await statusResV.json();
      const registrosV: any[] = statusDataV?.data?.registros || [];
      const e = l.empleados as any;
      const reg = registrosV.find((r) => r.employee_uid === e.facturacom_uid) || registrosV.find((r) => r.data?.id === e.facturacom_uid) || registrosV.find((r) => r.data?.nombre === e.nombre);
      const timbrada = reg?.status_timbre === "timbrada";
      const ESPERANDO = ["en fila", "pendiente", "espera", "en proceso", "procesando"];
      const rechazada = reg?.status_timbre && reg.status_timbre !== "timbrada" && !ESPERANDO.includes(reg.status_timbre);
      const status = timbrada ? "timbrada" : (rechazada ? "error" : "pendiente");
      const mensaje = timbrada
        ? "Timbrada correctamente"
        : (reg?.mensaje || `factura.com todavía no confirma el timbrado (status: ${reg?.status_timbre || "sin registro"}).`);
      await db.from("nomina_lineas").update({ facturacom_status: status, facturacom_mensaje: mensaje, facturacom_uuid: reg?.uuid || null }).eq("id", verificar_linea_id);
      return json({ ok: true, status, mensaje });
    }

    if (!periodo_id) return json({ error: "Falta periodo_id" }, 400);

    const { data: periodo, error: periodoErr } = await db.from("nomina_periodos").select("*").eq("id", periodo_id).single();
    if (periodoErr || !periodo) return json({ error: "No se encontró el periodo de nómina" }, 404);

    const ent: string = periodo.entidad;
    // Credenciales editables desde Configuracion (tabla, no secrets de
    // Supabase) para que un admin las pueda ver/corregir el mismo desde
    // el sistema en vez de depender de la CLI.
    const { data: cred } = await db.from("facturacom_credenciales").select("*").eq("entidad", ent).maybeSingle();
    const apiKey = cred?.api_key;
    const secretKey = cred?.secret_key;
    const serie = cred?.serie;
    const patronal = cred?.patronal;
    if (!apiKey || !secretKey || !serie || !patronal) {
      return json({ error: `Faltan las llaves de factura.com configuradas para ${ENT_LABEL[ent] || ent}. Ve a Configuración → Facturación.` }, 500);
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
      const salarioIntegrado = calcularSalarioIntegrado(e.salario_diario, e.fecha_ingreso);
      const empleadoRes = await fetch(`${HOST}/payroll/employee/create`, {
        method: "POST", headers, body: JSON.stringify({
          grupo: grupoUid,
          no_empleado: e.id.slice(0, 8),
          nombre: partes[0] || e.nombre,
          paterno: partes[1] || "",
          materno: partes.slice(2).join(" ") || "",
          metodo_pago: "01", // Efectivo (antes 03=Transferencia, incorrecto -- se paga en efectivo)
          periodo: "02", // Semanal (antes 04=Quincenal, incorrecto -- la nomina que se timbra es semanal)
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
          tipo_jornada: "03", // Mixta (antes 01=Diurna, incorrecto -- todos son jornada mixta)
          patronal,
          cuota_diaria: String(salarioIntegrado),
          salario: String(salarioIntegrado),
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
    // OJO: tiene que ser la hora LOCAL de Mexico, no UTC -- new Date().toISOString()
    // regresa UTC (6 horas adelantada a Veracruz/Puebla) mientras conserva un formato
    // que parece hora local, lo que mandaba una fecha adelantada disfrazada de correcta.
    const fechaFromApi = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Mexico_City",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(new Date()).replace(" ", "T");
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
      const mensaje = "factura.com rechazó la nómina: " + JSON.stringify(nominaData);
      for (const l of listosConUid) {
        resultados.push({ linea_id: l.id, empleado: (l.empleados as any).nombre, status: "error", mensaje });
      }
      await db.from("nomina_lineas").update({ facturacom_status: "error", facturacom_mensaje: mensaje }).in(
        "id",
        listosConUid.map((l) => l.id),
      );
      return json({ ok: false, timbrados: 0, resultados });
    }

    // El timbrado es asíncrono y factura.com puede tardar bastante mas de
    // unos segundos (se vio un caso real quedarse "En fila" en su propio
    // panel bastante despues). Se espera mas tiempo, pero si aun asi no se
    // confirma no se marca como "error" -- eso invitaba a reintentar y
    // arriesgar timbrar dos veces a la misma persona. Se marca "pendiente"
    // y se guarda el uid del lote para poder volver a consultarlo despues
    // sin generar un CFDI nuevo.
    await new Promise((r) => setTimeout(r, 15000));
    const statusRes = await fetch(`${HOST}/payroll/${nominaData.uid}/view`, { headers });
    const statusData = await statusRes.json();
    const registrosStatus: any[] = statusData?.data?.registros || [];

    let timbrados = 0;
    for (const l of listosConUid) {
      const e = l.empleados as any;
      const reg = registrosStatus.find((r) => r.employee_uid === e.facturacom_uid) || registrosStatus.find((r) => r.data?.id === e.facturacom_uid) || registrosStatus.find((r) => r.data?.nombre === e.nombre);
      const timbrada = reg?.status_timbre === "timbrada";
      const ESPERANDO = ["en fila", "pendiente", "espera", "en proceso", "procesando"];
      const rechazada = reg?.status_timbre && reg.status_timbre !== "timbrada" && !ESPERANDO.includes(reg.status_timbre);
      if (timbrada) timbrados++;
      const status = timbrada ? "timbrada" : (rechazada ? "error" : "pendiente");
      const mensaje = timbrada
        ? "Timbrada correctamente"
        : (reg?.mensaje || `factura.com todavía no confirma el timbrado (status: ${reg?.status_timbre || "sin registro"}). Usa "Verificar estatus" en unos minutos, no vuelvas a timbrar.`);
      resultados.push({ linea_id: l.id, empleado: e.nombre, status, mensaje });
      await db.from("nomina_lineas").update({
        facturacom_status: status,
        facturacom_mensaje: mensaje,
        facturacom_uuid: reg?.uuid || null,
        facturacom_nomina_uid: nominaData.uid,
      }).eq("id", l.id);
    }
    await db.from("nomina_periodos").update({ timbrado_en: new Date().toISOString() }).eq("id", periodo_id);

    return json({ ok: timbrados > 0, timbrados, total: listosConUid.length, resultados, nomina_uid: nominaData.uid });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error inesperado" }, 500);
  }
});
