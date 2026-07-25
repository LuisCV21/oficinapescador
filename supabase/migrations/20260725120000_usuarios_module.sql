-- Módulo de usuarios: columnas adicionales en perfiles + RLS para que
-- cada quien vea su propio perfil y los admins vean/editen todos.
alter table public.perfiles add column if not exists correo text;
alter table public.perfiles add column if not exists activo boolean not null default true;
alter table public.perfiles add column if not exists updated_at timestamptz default now();
alter table public.perfiles alter column rol set default 'oficinista';

alter table public.perfiles enable row level security;

drop policy if exists "perfiles_select_own_or_admin" on public.perfiles;
create policy "perfiles_select_own_or_admin" on public.perfiles
  for select using (
    auth.uid() = id
    or exists (select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'admin')
  );

drop policy if exists "perfiles_update_admin_only" on public.perfiles;
create policy "perfiles_update_admin_only" on public.perfiles
  for update using (
    exists (select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'admin')
  );
