-- Facturacion individual (a un cliente con su propio RFC) generada desde
-- Oficina para un folio de venta puntual -- misma idea que facturas_globales
-- pero UNA por folio, se timbra directo (sin borrador, igual que ya hace
-- Pescador POS para individuales: el cliente esta esperando su CFDI ahi
-- mismo, no tiene sentido dejarlo como borrador para revisar despues).
create table if not exists public.facturas_individuales (
  id uuid primary key default gen_random_uuid(),
  entidad text not null check (entidad in ('HOT','PUE','FLO')),
  folio integer not null,
  cuenta text,
  fecha_venta text,
  subtotal numeric not null,
  iva numeric not null,
  total numeric not null,
  forma_pago text not null,       -- clave SAT del pago real (03/04/28)
  metodo_pago text not null default 'PUE',
  rfc_receptor text not null,
  razon_social text not null,
  regimen_fiscal text not null,
  uso_cfdi text not null,
  cp_receptor text not null,
  email_receptor text,
  estado text not null default 'timbrada' check (estado in ('timbrada','cancelada')),
  facturapi_id text,
  uuid_fiscal text,
  folio_pac text,
  creado_por uuid references auth.users(id),
  fecha_creacion timestamptz not null default now(),
  unique (entidad, folio)
);

create index if not exists facturas_individuales_entidad_idx
  on public.facturas_individuales (entidad);

alter table public.facturas_individuales enable row level security;

create policy "facturas_individuales_oficina_select" on public.facturas_individuales
  for select to authenticated
  using (exists (select 1 from public.perfiles where id = auth.uid() and rol in ('admin','oficinista')));

grant select on public.facturas_individuales to authenticated;
