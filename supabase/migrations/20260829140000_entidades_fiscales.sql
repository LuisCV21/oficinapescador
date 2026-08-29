-- Datos fiscales (razon social, RFC, domicilio) por entidad -- separado de
-- facturacom_credenciales (que SI es sensible y solo admin puede leer)
-- porque esto ya sale impreso en cada factura/recibo que cualquier usuario
-- autenticado puede ver, y lo necesita el reporte de facturacion diario
-- ("Ventas del mes") para armar el encabezado igual que el Excel manual
-- que se hacia antes.
create table if not exists public.entidades_fiscales (
  entidad text primary key check (entidad in ('HOT','PUE','FLO')),
  razon_social text,
  rfc text,
  domicilio_fiscal text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.entidades_fiscales enable row level security;

create policy "entidades_fiscales_select" on public.entidades_fiscales
  for select to authenticated using (true);

create policy "entidades_fiscales_upsert" on public.entidades_fiscales
  for insert to authenticated with check (true);

create policy "entidades_fiscales_update" on public.entidades_fiscales
  for update to authenticated using (true) with check (true);

grant select, insert, update on public.entidades_fiscales to authenticated;

insert into public.entidades_fiscales (entidad, razon_social, rfc, domicilio_fiscal) values
  ('FLO', 'LUIS ANTONIO CLEMENTE VAQUIER', 'CEVL9805214M2', 'CARRETERA POZA RICA SN. KM 47. CP.93523 PAPANTLA VERACRUZ'),
  ('PUE', 'ANA KATERYN CLEMENTE VAQUIER', 'CEVA010525IH3', 'AVENIDA PUEBLA 505 COLONIA PALMA SOLA'),
  ('HOT', 'ANA KATERYN CLEMENTE VAQUIER', 'CEVA010525IH3', 'AVENIDA PUEBLA 505 COLONIA PALMA SOLA')
on conflict (entidad) do update set
  razon_social = excluded.razon_social,
  rfc = excluded.rfc,
  domicilio_fiscal = excluded.domicilio_fiscal;
