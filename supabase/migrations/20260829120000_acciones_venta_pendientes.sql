-- Cancelaciones y sustituciones de CFDI (y cambios de forma de pago sobre
-- una venta YA facturada) que Oficina pide para Florida/Puebla. A diferencia
-- de correcciones_pago_pendientes (que solo corrige el folio ANTES de
-- facturar y se aplica sola), esto es una accion fiscal real ante el SAT --
-- Pescador POS la deja en cola y una persona en la sucursal la revisa y
-- confirma con un clic (dialogo ya existente DialogoCancelarFactura) antes
-- de que se ejecute. Mismo patron de conexion que las demas: el POS siempre
-- inicia (GET/POST), nunca al reves.
create table if not exists public.acciones_venta_pendientes (
  id uuid primary key default gen_random_uuid(),
  sucursal text not null,
  folio integer not null,
  turno_id integer,
  tipo text not null check (tipo in ('cancelacion', 'sustitucion')),
  forma_pago_nueva text,
  motivo text,
  creada_por text,
  creada_at timestamptz not null default now(),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aplicada', 'rechazada')),
  resuelta_at timestamptz,
  resuelta_por text,
  resultado text,
  visto_por_oficina boolean not null default false
);

create index if not exists acciones_venta_pendientes_sucursal_pendientes_idx
  on public.acciones_venta_pendientes (sucursal)
  where estado = 'pendiente';

create index if not exists acciones_venta_pendientes_no_vistas_idx
  on public.acciones_venta_pendientes (sucursal)
  where estado != 'pendiente' and not visto_por_oficina;

alter table public.acciones_venta_pendientes enable row level security;

-- Oficina ve todo, crea solicitudes nuevas, marca como vistas las ya
-- resueltas, y puede cancelar (borrar) una que siga pendiente si se
-- arrepiente antes de que el POS la aplique.
create policy "acciones_venta_select" on public.acciones_venta_pendientes
  for select to authenticated using (true);

create policy "acciones_venta_insert" on public.acciones_venta_pendientes
  for insert to authenticated with check (estado = 'pendiente');

create policy "acciones_venta_update_visto" on public.acciones_venta_pendientes
  for update to authenticated using (true) with check (true);

create policy "acciones_venta_delete_pendiente" on public.acciones_venta_pendientes
  for delete to authenticated using (estado = 'pendiente');

-- Grants base de SQL -- las policies de RLS son un filtro adicional, no
-- sustituyen esto (ver 20260818120000_correcciones_pago_grants.sql, mismo
-- error ya se repitio con dos tablas antes).
grant select, insert, update, delete on public.acciones_venta_pendientes to authenticated;
grant select, insert, update, delete on public.acciones_venta_pendientes to service_role;
