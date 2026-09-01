-- Directorio consolidado de clientes que han pedido factura en cualquiera
-- de las 3 entidades (Hotel/Puebla/Florida) -- "por si acaso la
-- necesitamos" (pedido explícito del dueño), y también sirve para
-- autocompletar el formulario de "Facturar folio individual" en Oficina
-- con el RFC de un cliente que ya facturó antes en OTRA sucursal.
-- Solo los datos necesarios para facturar -- nada de historial de compras
-- ni datos personales de más.
create table if not exists public.clientes_fiscales (
  id uuid primary key default gen_random_uuid(),
  rfc text not null unique,
  razon_social text not null,
  regimen_fiscal text,
  uso_cfdi text,
  cp text,
  email text,
  sucursales text[] not null default '{}',  -- en cuáles entidades (HOT/PUE/FLO) ha facturado
  ultima_factura timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists clientes_fiscales_razon_idx on public.clientes_fiscales (razon_social);

alter table public.clientes_fiscales enable row level security;

create policy "clientes_fiscales_oficina_select" on public.clientes_fiscales
  for select to authenticated
  using (exists (select 1 from public.perfiles where id = auth.uid() and rol in ('admin','oficinista')));

grant select on public.clientes_fiscales to authenticated;
