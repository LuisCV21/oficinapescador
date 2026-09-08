// Módulo de PRUEBA: timbra una nómina de sandbox en Factura.com para
// confirmar que el flujo grupo -> empleado -> nómina funciona llamado
// desde Oficina Pescador. Las llaves de Factura.com viven como secretos
// de la función (nunca llegan al navegador). No usar en producción tal
// cual — falta capturar datos reales de empleados/percepciones.
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

function facturacomHeaders(apiKey: string, secretKey: string) {
  return {
    "Content-Type": "application/json",
    "F-PLUGIN": F_PLUGIN,
    "F-Api-Key": apiKey,
    "F-Secret-Key": secretKey,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller) return json({ error: "Sesión inválida" }, 401);

    const { data: callerPerfil } = await callerClient
      .from("perfiles")
      .select("rol")
      .eq("id", caller.id)
      .single();
    if (!callerPerfil || callerPerfil.rol !== "admin") {
      return json({ error: "Solo un administrador puede usar este módulo de prueba" }, 403);
    }

    const apiKey = Deno.env.get("FACTURACOM_API_KEY");
    const secretKey = Deno.env.get("FACTURACOM_SECRET_KEY");
    if (!apiKey || !secretKey) {
      return json({ error: "Faltan los secretos FACTURACOM_API_KEY / FACTURACOM_SECRET_KEY" }, 500);
    }

    const HOST = "https://sandbox.factura.com/api";
    const headers = facturacomHeaders(apiKey, secretKey);
    const body = await req.json().catch(() => ({}));

    // Solo reconsulta el estatus de un lote ya enviado (sin crear nada nuevo)
    // -- para ver si un batch grande sigue avanzando sin tener que reenviarlo.
    if (body.verificar_uid) {
      const statusRes = await fetch(`${HOST}/payroll/${body.verificar_uid}/view`, { headers });
      const statusData = await statusRes.json();
      const registros: any[] = statusData?.data?.registros || [];
      const timbradas = registros.filter((r) => r?.status_timbre === "timbrada").length;
      const estatusPorEmpleado = registros.map((r) => ({
        nombre: r?.data?.nombre, status: r?.status_timbre, mensaje: r?.mensaje, raw: r,
      }));
      return json({ timbradas, total: registros.length, estatusPorEmpleado, statusDataCompleto: statusData });
    }

    // periodo_id: replica el envio REAL de produccion (mismos empleados, CURP,
    // RFC, NSS, percepciones, deducciones y FechaFromAPI que se mandaron el
    // 22 de agosto para Puebla) pero contra sandbox, para descartar que algo
    // especifico de esos datos reales (no de datos genericos de prueba) sea
    // lo que se atoro en produccion.
    if (body.periodo_id) {
      const svcKey = Deno.env.get("SERVICE_ROLE_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const db = createClient(supabaseUrl, svcKey);
      const { data: periodo } = await db.from("nomina_periodos").select("*").eq("id", body.periodo_id).single();
      if (!periodo) return json({ error: "periodo no encontrado" }, 404);
      let lineasQuery = db
        .from("nomina_lineas")
        .select("*, empleados(id,nombre,curp,rfc,nss,salario_diario,puesto_id,fecha_ingreso,tipo_contrato,domicilio)")
        .eq("periodo_id", body.periodo_id);
      if (Array.isArray(body.linea_ids) && body.linea_ids.length) lineasQuery = lineasQuery.in("id", body.linea_ids);
      const { data: lineas } = await lineasQuery;
      const { data: puestos } = await db.from("puestos").select("id,nombre");
      const puestoNombre = (id: string | null) => puestos?.find((p) => p.id === id)?.nombre || "EMPLEADO";
      function separarNombreCompleto(nc: string) {
        const partes = String(nc).trim().toUpperCase().split(/\s+/).filter(Boolean);
        if (partes.length <= 1) return { nombre: partes[0] || "", paterno: "", materno: "" };
        if (partes.length === 2) return { nombre: partes[0], paterno: partes[1], materno: "" };
        return { nombre: partes.slice(0, -2).join(" "), paterno: partes[partes.length - 2], materno: partes[partes.length - 1] };
      }
      function extraerCP(dom: string | null | undefined) {
        if (!dom) return null;
        const m = dom.match(/C\.?\s*P\.?\s*(\d{5})/i);
        return m ? m[1] : null;
      }
      const dom = { calle: "CARRETERA POZA RICA CAZONES", no_ext: "SN", colonia: "CENTRO", cp: "93523", municipio: "Papantla", estado: "Veracruz - VER" };

      const grupoRes = await fetch(`${HOST}/payroll/employee/group/create`, {
        method: "POST", headers, body: JSON.stringify({ grupo: `Prueba REAL OficinaPescador ${Date.now()}` }),
      });
      const grupoData = await grupoRes.json();
      if (grupoData.response !== "success") return json({ ok: false, paso: "grupo", detalle: grupoData }, 200);

      const registros: any[] = [];
      const fallos: any[] = [];
      for (const l of lineas || []) {
        const e = l.empleados as any;
        if (!e || !e.curp || !e.rfc || !e.nss) continue;
        const { nombre: nombrePila, paterno, materno } = separarNombreCompleto(e.nombre);
        const empleadoRes = await fetch(`${HOST}/payroll/employee/create`, {
          method: "POST", headers, body: JSON.stringify({
            grupo: grupoData.uid,
            no_empleado: e.id.slice(0, 8),
            nombre: nombrePila, paterno, materno,
            metodo_pago: "01", periodo: "02", regimen: "02",
            puesto: puestoNombre(e.puesto_id), departamento: "Puebla",
            curp: e.curp, imss: e.nss, rfc: e.rfc,
            calle: dom.calle, colonia: dom.colonia, no_ext: dom.no_ext,
            cp: extraerCP(e.domicilio) || dom.cp, municipio: dom.municipio, estado: dom.estado,
            tipo_contrato: "01", asimilados: "0", sindicalizado: "No", entidad_emite: "VER",
            tipo_jornada: "03", patronal: "A7025105103",
            cuota_diaria: String(e.salario_diario), salario: String(e.salario_diario),
            riesgo: "2", inicio: e.fecha_ingreso,
          }),
        });
        const empleadoData = await empleadoRes.json();
        if (empleadoData.response !== "success") { fallos.push({ nombre: e.nombre, error: empleadoData }); continue; }
        const salario = Number(l.salario_diario) || 0;
        const diasPagados = Number(l.dias_pagados) || 0;
        const sueldo = salario * diasPagados;
        const prima = l.trabajo_domingo ? salario * 0.25 : 0;
        const percepciones = [{ tipo: "001", clave: "001", descripcion: "Sueldos, salarios rayas y jornales", exento: "0", gravado: sueldo.toFixed(2) }];
        if (prima > 0) percepciones.push({ tipo: "020", clave: "020", descripcion: "Prima dominical", exento: "0", gravado: prima.toFixed(2) });
        const deducciones = [];
        if (Number(l.retencion_isr) > 0) deducciones.push({ tipo: "002", clave: "002", descripcion: "ISR", importe: Number(l.retencion_isr).toFixed(2) });
        if (Number(l.retencion_imss) > 0) deducciones.push({ tipo: "001", clave: "001", descripcion: "Seguridad social", importe: Number(l.retencion_imss).toFixed(2) });
        registros.push({
          data: { id: empleadoData.data.uid, nombre: String(e.nombre).trim().toUpperCase(), puesto: puestoNombre(e.puesto_id), dias: diasPagados },
          percepciones, deducciones,
          otrospagos: [{
            tipo: "002", clave: "002", descripcion: "Subsidio al empleo", importe: "0.00",
            SubsidioAlEmpleo: { SubsidioCausado: "0.00" },
          }],
        });
      }
      if (!registros.length) return json({ ok: false, error: "nadie quedo listo", fallos }, 200);

      const fechaFromApi = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      }).format(new Date()).replace(" ", "T");

      const nominaRes = await fetch(`${HOST}/payroll/create`, {
        method: "POST", headers, body: JSON.stringify({
          grupo: grupoData.uid,
          fecha_pago: periodo.fecha_pago || periodo.semana_fin,
          num_dias: 7, inicial: periodo.semana_inicio, final: periodo.semana_fin,
          tipo_nomina: "O",
          descripcion: `Nómina Puebla ${periodo.semana_inicio} a ${periodo.semana_fin} (PRUEBA REAL sandbox)`,
          serie: 5503481, concepto: "Pago de nómina",
          identificador: `OFICINAPRUEBA-${body.periodo_id}-${Date.now()}`,
          version_cfdi: "4.0", FechaFromAPI: fechaFromApi, registros,
        }),
      });
      const nominaData = await nominaRes.json();
      if (nominaData.response !== "success") return json({ ok: false, paso: "nomina", detalle: nominaData, fallos }, 200);

      await new Promise((r) => setTimeout(r, 15000));
      const statusRes = await fetch(`${HOST}/payroll/${nominaData.uid}/view`, { headers });
      const statusData = await statusRes.json();
      const registrosStatus: any[] = statusData?.data?.registros || [];
      const timbradas = registrosStatus.filter((r) => r?.status_timbre === "timbrada").length;
      const estatusPorEmpleado = registrosStatus.map((r) => ({ nombre: r?.data?.nombre, status: r?.status_timbre }));
      return json({
        ok: timbradas === registros.length,
        timbradas, total: registros.length, enviados: registros.length, fallos,
        nomina_uid: nominaData.uid, estatusPorEmpleado,
      });
    }

    const nombre = body.nombre || "EMPLEADO DE PRUEBA";
    const salario = Number(body.salario) || 50;
    // cantidad: para reproducir a proposito el problema real de produccion
    // (21 empleados en un solo payroll/create se quedaron "en fila" mas de 48h
    // en factura.com, mientras que 1 solo empleado se timbro en minutos) --
    // manda un lote de N empleados de prueba en sandbox para ver si ahi
    // tambien se atora, y asi confirmar si es un limite de tamano de lote del
    // lado de factura.com y no un problema de nuestros datos.
    const cantidad = Math.max(1, Math.min(50, Number(body.cantidad) || 1));

    const pasos: Record<string, unknown> = {};

    // 1. Grupo
    const grupoRes = await fetch(`${HOST}/payroll/employee/group/create`, {
      method: "POST", headers, body: JSON.stringify({ grupo: `Prueba OficinaPescador ${Date.now()}` }),
    });
    const grupoData = await grupoRes.json();
    pasos.grupo = grupoData;
    if (grupoData.response !== "success") return json({ ok: false, pasos }, 200);

    // 2. Empleado(s) -- uno o, si cantidad>1, un lote completo
    const empleados: Array<{ uid: string; nombre: string }> = [];
    for (let i = 1; i <= cantidad; i++) {
      const nombreI = cantidad === 1 ? nombre : `${nombre} ${i}`;
      const empleadoRes = await fetch(`${HOST}/payroll/employee/create`, {
        method: "POST", headers, body: JSON.stringify({
          grupo: grupoData.uid,
          no_empleado: String(i),
          nombre: nombreI.split(" ")[0] || "EMPLEADO",
          paterno: nombreI.split(" ")[1] || "PRUEBA",
          materno: nombreI.split(" ")[2] || "OFICINA",
          metodo_pago: "03",
          periodo: "04",
          regimen: "02",
          puesto: "PRUEBA",
          departamento: "PRUEBA",
          curp: "XEXX010101HNEXXXA4",
          imss: "12345678901",
          rfc: "XAXX010101000",
          calle: "CARRETERA POZA RICA CAZONES",
          colonia: "CENTRO",
          no_ext: "SN",
          cp: "93523",
          municipio: "Papantla",
          estado: "Veracruz - VER",
          tipo_contrato: "01",
          asimilados: "0",
          sindicalizado: "No",
          entidad_emite: "VER",
          tipo_jornada: "01",
          patronal: "A7025105103",
          cuota_diaria: String(salario),
          salario: String(salario),
          riesgo: "2",
          inicio: "2023-07-03",
        }),
      });
      const empleadoData = await empleadoRes.json();
      if (i === 1) pasos.empleado = empleadoData;
      if (empleadoData.response !== "success") {
        pasos.empleado_fallo_en = i;
        pasos.empleado_error = empleadoData;
        return json({ ok: false, pasos }, 200);
      }
      empleados.push({ uid: empleadoData.data.uid, nombre: nombreI });
    }
    pasos.empleados_creados = empleados.length;

    // 3. Nómina -- un solo payroll/create con todos los empleados del lote
    const hoy = new Date().toISOString().slice(0, 10);
    const nominaRes = await fetch(`${HOST}/payroll/create`, {
      method: "POST", headers, body: JSON.stringify({
        grupo: grupoData.uid,
        fecha_pago: hoy,
        num_dias: 1,
        inicial: hoy,
        final: hoy,
        tipo_nomina: "O",
        descripcion: "Nomina de prueba desde Oficina Pescador",
        serie: 5503481, // OJO: id de serie "NOM" de la empresa de prueba usada al desarrollar esto
        concepto: "Pago de nomina de prueba",
        identificador: `OFICINA-${Date.now()}`,
        version_cfdi: "4.0",
        registros: empleados.map((e) => ({
          data: { id: e.uid, nombre: e.nombre, puesto: "PRUEBA", dias: 1 },
          percepciones: [
            { tipo: "001", clave: "001", descripcion: "Sueldos", exento: "0", gravado: String(salario) },
          ],
          deducciones: [
            { tipo: "002", clave: "002", descripcion: "ISR", importe: "0.00" },
          ],
          otrospagos: [{
            tipo: "002", clave: "002", descripcion: "Subsidio al empleo", importe: "0.00",
            SubsidioAlEmpleo: { SubsidioCausado: "0.00" },
          }],
        })),
      }),
    });
    const nominaData = await nominaRes.json();
    pasos.nomina = nominaData;

    if (nominaData.response !== "success") return json({ ok: false, pasos }, 200);

    // 4. Consultar estatus final (el timbrado es asíncrono)
    await new Promise((r) => setTimeout(r, 6000));
    const statusRes = await fetch(`${HOST}/payroll/${nominaData.uid}/view`, { headers });
    const statusData = await statusRes.json();
    pasos.estatus_final = statusData;

    const registros: any[] = statusData?.data?.registros || [];
    const timbradas = registros.filter((r) => r?.status_timbre === "timbrada").length;
    const estatusPorEmpleado = registros.map((r) => ({ nombre: r?.data?.nombre, status: r?.status_timbre }));

    return json({
      ok: timbradas === empleados.length,
      timbradas,
      total: empleados.length,
      nomina_uid: nominaData.uid,
      estatusPorEmpleado,
      pasos,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error inesperado" }, 500);
  }
});
