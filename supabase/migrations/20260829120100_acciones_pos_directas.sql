-- Bitacora de cancelaciones/sustituciones/cambios de forma de pago que
-- Pescador POS ejecuto POR SU CUENTA (no porque Oficina lo haya pedido en
-- acciones_venta_pendientes) -- para que Oficina se entere sin tener que
-- preguntar al restaurante. El POS empuja un registro aqui cada vez que
-- termina una de estas acciones localmente; Oficina la lee y la marca vista.
create table if not exists public.acciones_pos_directas (
  id uuid primary key default gen_random_uuid(),
  sucursal text not null,
  folio integer,
  tipo text not null check (tipo in ('cancelacion', 'sustitucion')),
  detalle text,
  usuario text,
  creada_at timestamptz not null default now(),
  visto_por_oficina boolean not null default false
);

create index if not exists acciones_pos_directas_no_vistas_idx
  on public.acciones_pos_directas (sucursal)
  where not visto_por_oficina;

alter table public.acciones_pos_directas enable row level security;

create policy "acciones_pos_directas_select" on public.acciones_pos_directas
  for select to authenticated using (true);

create policy "acciones_pos_directas_update_visto" on public.acciones_pos_directas
  for update to authenticated using (true) with check (true);

grant select, update on public.acciones_pos_directas to authenticated;
grant select, insert, update on public.acciones_pos_directas to service_role;
