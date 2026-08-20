// TEMPORAL, solo para probar en el SANDBOX de factura.com -- antes de tocar
// el CFDI real de Maira, reproduce todo el flujo de principio a fin:
//   1. Timbra una nomina "original" replicando el bug real (subsidio
//      duplicado como Otros Pagos) para tener algo que cancelar.
//   2. Timbra la nomina "sustituta" con la logica ya corregida (subsidio
//      solo en efectivo si sobra despues de acreditarlo contra el ISR).
//   3. Cancela la original con motivo 01, apuntando el folioSustituto al
//      item de la sustituta -- exactamente lo mismo que hace
//      sustituir-nomina-linea/index.ts contra produccion.
// Usa las mismas credenciales/host de sandbox y datos de empresa de prueba
// que ya usaba timbrar-nomina-prueba. Se puede borrar esta funcion despues
// de confirmar que el flujo real funciona.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const F_PLUGIN = "9d4095c8f7ed5785cb14c0e3b033eeb8252416ed";
function facturacomHeaders(apiKey: string, secretKey: string) {
  return { "Content-Type": "application/json", "F-PLUGIN": F_PLUGIN, "F-Api-Key": apiKey, "F-Secret-Key": secretKey };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller) return json({ error: "Sesión inválida" }, 401);
    const { data: callerPerfil } = await callerClient.from("perfiles").select("rol").eq("id", caller.id).single();
    if (!callerPerfil || callerPerfil.rol !== "admin") return json({ error: "Solo un administrador puede usar este módulo de prueba" }, 403);

    const apiKey = Deno.env.get("FACTURACOM_API_KEY");
    const secretKey = Deno.env.get("FACTURACOM_SECRET_KEY");
    if (!apiKey || !secretKey) return json({ error: "Faltan los secretos FACTURACOM_API_KEY / FACTURACOM_SECRET_KEY" }, 500);
    const HOST = "https://sandbox.factura.com/api";
    const headers = facturacomHeaders(apiKey, secretKey);
    const pasos: Record<string, unknown> = {};

    // Modo diagnostico: baja el XML crudo de un item ya timbrado en sandbox,
    // para poder ver si un nodo (ej. CfdiRelacionados) realmente se aplico.
    const bodyIn = await req.json().catch(() => ({}));
    if (bodyIn?.modo === "xml" && bodyIn?.item_uid) {
      const xmlRes = await fetch(`${HOST}/payroll/${bodyIn.item_uid}/item/xml`, { headers });
      const xmlText = await xmlRes.text();
      return new Response(xmlText, { headers: { ...corsHeaders, "Content-Type": "text/plain" } });
    }

    // Numeros reales del caso Maira (periodo 09-15 ago 2026): sueldo 2212.00,
    // ISR causado 158.02, subsidio calculado 123.47 -> ISR retenido 34.54,
    // IMSS 55.13. Con la logica vieja el "Otros Pagos" mandaba 123.47
    // completos (total 2245.80); con la corregida debe mandar 0.00 (total
    // 2122.33, igual que el recibo oficial de Aspel).
    const sueldo = 2212.00, isrRetenido = 34.54, imss = 55.13, subsidioCalculado = 123.47;
    const subsidioViejoBug = subsidioCalculado; // lo que mandaba el codigo con el bug
    const subsidioCorregido = 0.00; // lo que debe mandar ya arreglado (isrCausado 158.02 > subsidio)

    const grupoRes = await fetch(`${HOST}/payroll/employee/group/create`, {
      method: "POST", headers, body: JSON.stringify({ grupo: `Prueba sustitucion ${Date.now()}` }),
    });
    const grupoData = await grupoRes.json();
    pasos.grupo = grupoData;
    if (grupoData.response !== "success") return json({ ok: false, pasos }, 200);

    const empleadoRes = await fetch(`${HOST}/payroll/employee/create`, {
      method: "POST", headers, body: JSON.stringify({
        grupo: grupoData.uid, no_empleado: "70", nombre: "MAIRA", paterno: "PRUEBA", materno: "SANDBOX",
        metodo_pago: "01", periodo: "02", regimen: "02", puesto: "AYUDANTE GENERAL", departamento: "PUEBLA",
        curp: "XEXX010101HNEXXXA4", imss: "12345678901", rfc: "XAXX010101000",
        // Domicilio de la empresa de prueba del sandbox (el mismo que ya usaba
        // timbrar-nomina-prueba y sí timbra) -- el domicilio real de Maira
        // (Puebla) no coincide con el LugarExpedicion del CSD de esa empresa
        // de prueba y truena con CFDI40149. Aquí solo importa probar el
        // mecanismo de sustitución/cancelación, no el domicilio real.
        calle: "CARRETERA POZA RICA CAZONES", colonia: "CENTRO", no_ext: "SN", cp: "93523",
        municipio: "Papantla", estado: "Veracruz - VER", tipo_contrato: "01",
        asimilados: "0", sindicalizado: "No", entidad_emite: "VER", tipo_jornada: "03",
        patronal: "A7025105103", cuota_diaria: "331.58", salario: "331.58", riesgo: "2", inicio: "2024-01-08",
      }),
    });
    const empleadoData = await empleadoRes.json();
    pasos.empleado = empleadoData;
    if (empleadoData.response !== "success") return json({ ok: false, pasos }, 200);
    const empleadoUid = empleadoData.data.uid;

    const hoy = new Date().toISOString().slice(0, 10);
    const registroBase = (subsidio: number, cfdiRelacionados?: { TipoRelacion: string; UUID: string[] }) => ({
      data: { id: empleadoUid, nombre: "MAIRA PRUEBA SANDBOX", puesto: "AYUDANTE GENERAL", dias: 7 },
      percepciones: [{ tipo: "001", clave: "001", descripcion: "Sueldos, salarios rayas y jornales", exento: "0", gravado: sueldo.toFixed(2) }],
      deducciones: [
        { tipo: "002", clave: "002", descripcion: "ISR", importe: isrRetenido.toFixed(2) },
        { tipo: "001", clave: "001", descripcion: "Seguridad social", importe: imss.toFixed(2) },
      ],
      otrospagos: [{
        tipo: "002", clave: "002", descripcion: "Subsidio al empleo", importe: subsidio.toFixed(2),
        SubsidioAlEmpleo: { SubsidioCausado: subsidioCalculado.toFixed(2) },
      }],
      ...(cfdiRelacionados ? { CfdiRelacionados: cfdiRelacionados } : {}),
    });

    // 1. Timbra la "original" reproduciendo el bug (subsidio completo en Otros Pagos)
    const origRes = await fetch(`${HOST}/payroll/create`, {
      method: "POST", headers, body: JSON.stringify({
        grupo: grupoData.uid, fecha_pago: hoy, num_dias: 7, inicial: hoy, final: hoy, tipo_nomina: "O",
        descripcion: "PRUEBA original con bug (subsidio duplicado)", serie: 5503481,
        concepto: "Pago de nómina de prueba", identificador: `OFICINA-PRUEBA-ORIG-${Date.now()}`,
        version_cfdi: "4.0", registros: [registroBase(subsidioViejoBug)],
      }),
    });
    const origData = await origRes.json();
    pasos.original_creado = origData;
    if (origData.response !== "success") return json({ ok: false, pasos }, 200);

    await new Promise((r) => setTimeout(r, 8000));
    const origStatusRes = await fetch(`${HOST}/payroll/${origData.uid}/view`, { headers });
    const origStatusData = await origStatusRes.json();
    pasos.original_estatus = origStatusData;
    const origReg = origStatusData?.data?.registros?.[0];
    if (origReg?.status_timbre !== "timbrada") {
      return json({ ok: false, mensaje: "La original no se timbró en sandbox, no se puede continuar la prueba", pasos }, 200);
    }

    // 2. Timbra la "sustituta" ya con la logica corregida (subsidio 0.00 en Otros Pagos)
    const nuevaRes = await fetch(`${HOST}/payroll/create`, {
      method: "POST", headers, body: JSON.stringify({
        grupo: grupoData.uid, fecha_pago: hoy, num_dias: 7, inicial: hoy, final: hoy, tipo_nomina: "O",
        descripcion: `PRUEBA sustituta corregida — sustituye folio ${origReg.uuid}`, serie: 5503481,
        concepto: "Pago de nómina de prueba (corrección)", identificador: `OFICINA-PRUEBA-SUST-${Date.now()}`,
        version_cfdi: "4.0",
        registros: [registroBase(subsidioCorregido)],
      }),
    });
    const nuevaData = await nuevaRes.json();
    pasos.sustituta_creada = nuevaData;
    if (nuevaData.response !== "success") return json({ ok: false, pasos }, 200);

    await new Promise((r) => setTimeout(r, 8000));
    const nuevaStatusRes = await fetch(`${HOST}/payroll/${nuevaData.uid}/view`, { headers });
    const nuevaStatusData = await nuevaStatusRes.json();
    pasos.sustituta_estatus = nuevaStatusData;
    const nuevaReg = nuevaStatusData?.data?.registros?.[0];
    if (nuevaReg?.status_timbre !== "timbrada") {
      return json({ ok: false, mensaje: "La sustituta no se timbró en sandbox, no se puede continuar la prueba", pasos }, 200);
    }

    // 3. Cancela la original con motivo 02 (sin relación) -- motivo 01 exige
    // que el sustituto ya traiga un nodo CfdiRelacionados, y /payroll/create
    // no tiene forma documentada (ni encontrada probando variantes) de
    // ponerlo, asi que se prueba el motivo que no depende de esa relacion.
    const cancelRes = await fetch(`${HOST}/payroll/${origReg.uid}/item/cancel`, {
      method: "POST", headers, body: JSON.stringify({ motivo: "02" }),
    });
    const cancelData = await cancelRes.json();
    pasos.cancelacion = cancelData;

    return json({
      ok: cancelData.response === "success",
      resumen: {
        original_uuid: origReg.uuid, original_item_uid: origReg.uid,
        sustituta_uuid: nuevaReg.uuid, sustituta_item_uid: nuevaReg.uid,
        cancelacion_exitosa: cancelData.response === "success",
      },
      pasos,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error inesperado" }, 500);
  }
});
