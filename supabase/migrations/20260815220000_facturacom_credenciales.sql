-- Credenciales de factura.com por sucursal, editables desde Configuracion
-- (antes vivian como secrets de Supabase, que ni el admin del sistema podia
-- ver una vez guardados -- solo se podian sobreescribir a ciegas via CLI).
create table if not exists public.facturacom_credenciales (
  entidad text primary key check (entidad in ('HOT','PUE','FLO')),
  api_key text,
  secret_key text,
  serie text,
  patronal text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.facturacom_credenciales enable row level security;

-- Solo admin puede leer o escribir -- son credenciales sensibles de
-- facturacion real, no algo que un oficinista necesite ver para timbrar
-- (el timbrado las usa del lado del servidor via service_role, que se
-- salta RLS).
create policy "facturacom_credenciales_admin_select" on public.facturacom_credenciales
  for select to authenticated
  using (exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin'));
create policy "facturacom_credenciales_admin_insert" on public.facturacom_credenciales
  for insert to authenticated
  with check (exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin'));
create policy "facturacom_credenciales_admin_update" on public.facturacom_credenciales
  for update to authenticated
  using (exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin'))
  with check (exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin'));

grant select, insert, update on public.facturacom_credenciales to authenticated;
