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
    const nombre = body.nombre || "EMPLEADO DE PRUEBA";
    const salario = Number(body.salario) || 50;

    const pasos: Record<string, unknown> = {};

    // 1. Grupo
    const grupoRes = await fetch(`${HOST}/payroll/employee/group/create`, {
      method: "POST", headers, body: JSON.stringify({ grupo: `Prueba OficinaPescador ${Date.now()}` }),
    });
    const grupoData = await grupoRes.json();
    pasos.grupo = grupoData;
    if (grupoData.response !== "success") return json({ ok: false, pasos }, 200);

    // 2. Empleado
    const empleadoRes = await fetch(`${HOST}/payroll/employee/create`, {
      method: "POST", headers, body: JSON.stringify({
        grupo: grupoData.uid,
        no_empleado: "1",
        nombre: nombre.split(" ")[0] || "EMPLEADO",
        paterno: nombre.split(" ")[1] || "PRUEBA",
        materno: nombre.split(" ")[2] || "OFICINA",
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
    pasos.empleado = empleadoData;
    if (empleadoData.response !== "success") return json({ ok: false, pasos }, 200);
    const empleadoUid = empleadoData.data.uid;

    // 3. Nómina
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
        registros: [{
          data: { id: empleadoUid, nombre, puesto: "PRUEBA", dias: 1 },
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
        }],
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

    const registro = statusData?.data?.registros?.[0];
    const timbrada = registro?.status_timbre === "timbrada";

    return json({ ok: timbrada, uuid: registro?.uuid || null, pasos });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error inesperado" }, 500);
  }
});
