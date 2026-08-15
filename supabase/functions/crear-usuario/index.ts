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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    // Ver nota en timbrar-nomina/index.ts: SUPABASE_SERVICE_ROLE_KEY (variable
    // reservada inyectada por la plataforma) trae la llave nueva "sb_secret_"
    // en este proyecto, que no da permisos reales -- se usa SERVICE_ROLE_JWT
    // (secret propio con el JWT clasico de service_role) en su lugar.
    const serviceKey = Deno.env.get("SERVICE_ROLE_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Cliente con la sesión de quien llama, solo para verificar quién es.
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
      return json({ error: "Solo un administrador puede crear usuarios" }, 403);
    }

    const { nombre, correo, password, rol } = await req.json();
    if (!nombre || !correo || !password) {
      return json({ error: "Nombre, correo y contraseña son obligatorios" }, 400);
    }
    if (String(password).length < 6) {
      return json({ error: "La contraseña debe tener al menos 6 caracteres" }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: correo,
      password,
      email_confirm: true,
    });
    if (createErr) return json({ error: createErr.message }, 400);

    const { error: perfilErr } = await adminClient.from("perfiles").insert({
      id: created.user.id,
      nombre,
      correo,
      rol: rol === "admin" ? "admin" : "oficinista",
      activo: true,
    });
    if (perfilErr) {
      // evita dejar un usuario de auth huérfano sin perfil
      await adminClient.auth.admin.deleteUser(created.user.id);
      return json({ error: perfilErr.message }, 400);
    }

    return json({ ok: true, id: created.user.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error inesperado" }, 500);
  }
});
