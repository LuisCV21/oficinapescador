-- Fix: las politicas de perfiles referenciaban la misma tabla dentro de su
-- propia condicion (exists select ... from perfiles ...), lo que Postgres
-- detecta como recursion infinita y bloquea incluso la lectura del propio
-- perfil. Se mueve la verificacion de admin a una funcion security definer
-- que sí puede leer la tabla sin pasar de nuevo por RLS.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin');
$$;

drop policy if exists "perfiles_select_own_or_admin" on public.perfiles;
create policy "perfiles_select_own_or_admin" on public.perfiles
  for select using (
    auth.uid() = id or public.is_admin()
  );

drop policy if exists "perfiles_update_admin_only" on public.perfiles;
create policy "perfiles_update_admin_only" on public.perfiles
  for update using (
    public.is_admin()
  );
