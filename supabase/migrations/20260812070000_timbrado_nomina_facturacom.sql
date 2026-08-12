-- Soporte para timbrar de verdad las nominas semanales via factura.com.
-- Un "grupo" de factura.com se crea una sola vez por sucursal y se reusa;
-- cada empleado se registra una sola vez en factura.com (uid cacheado) y
-- luego solo se le crean nominas nuevas cada semana referenciando ese uid.

alter table public.empleados add column if not exists facturacom_uid text;

create table if not exists public.facturacom_grupos (
  entidad text primary key,
  grupo_uid text not null,
  created_at timestamptz not null default now()
);

alter table public.facturacom_grupos enable row level security;
create policy "facturacom_grupos_select" on public.facturacom_grupos for select to authenticated using (true);
grant select on public.facturacom_grupos to authenticated;
-- Solo la Edge Function (service role) inserta/actualiza grupos; el navegador nunca escribe aqui.

alter table public.nomina_lineas add column if not exists facturacom_uuid text;
alter table public.nomina_lineas add column if not exists facturacom_status text;
alter table public.nomina_lineas add column if not exists facturacom_mensaje text;

alter table public.nomina_periodos add column if not exists timbrado_en timestamptz;
