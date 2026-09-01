-- Facturacion Global generada desde Oficina (Fase 2: que las oficinistas
-- puedan cerrar el mes y facturar sin depender de que alguien en la
-- sucursal lo haga desde el POS local). Mismo flujo de 2 pasos que ya usa
-- Pescador POS (tab_global.py): se crea como BORRADOR primero, se revisa,
-- y se timbra en un paso aparte -- nunca se timbra directo.
--
-- 'folios' guarda que folios de venta (de cortes_caja.datos) quedaron
-- cubiertos por esta global -- es la fuente de verdad para no volver a
-- ofrecerlos la proxima vez, y lo que cada sucursal jala despues para
-- marcar sus pagos como facturados localmente y no duplicar el CFDI si
-- alguien corre la Global desde el POS tambien.
create table if not exists public.facturas_globales (
  id uuid primary key default gen_random_uuid(),
  entidad text not null check (entidad in ('HOT','PUE','FLO')),
  periodo_inicio date not null,
  periodo_fin date not null,
  forma_pago text not null,      -- clave SAT: 03 transferencia, 04 credito, 28 debito
  forma_nombre text not null,
  subtotal numeric not null default 0,
  iva numeric not null default 0,
  total numeric not null default 0,
  estado text not null default 'borrador' check (estado in ('borrador','timbrada','cancelada')),
  facturapi_id text,
  uuid_fiscal text,
  folio_cfdi integer,
  folios jsonb not null default '[]'::jsonb,
  creado_por uuid references auth.users(id),
  fecha_creacion timestamptz not null default now(),
  fecha_timbrado timestamptz,
  -- Cuando la sucursal ya jalo este resultado y lo aplico a su BD local
  -- (pagos.factura_id) -- para saber que ya no hace falta reenviarselo.
  sincronizada_sucursal boolean not null default false
);

create index if not exists facturas_globales_entidad_periodo_idx
  on public.facturas_globales (entidad, periodo_inicio, periodo_fin);

alter table public.facturas_globales enable row level security;

-- admin y oficinista pueden ver y operar -- es justo el punto de esta
-- tabla: que las oficinistas puedan cerrar el mes sin depender de un
-- admin ni de la sucursal. Las llaves de factura.com siguen aparte
-- (facturacom_credenciales, esas si admin-only) y el timbrado real lo
-- hace el Edge Function con service_role, no el cliente directo.
create policy "facturas_globales_oficina_select" on public.facturas_globales
  for select to authenticated
  using (exists (select 1 from public.perfiles where id = auth.uid() and rol in ('admin','oficinista')));

grant select on public.facturas_globales to authenticated;
