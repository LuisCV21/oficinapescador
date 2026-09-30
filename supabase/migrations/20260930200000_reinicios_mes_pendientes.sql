-- Solicitud de "reinicio de mes" de Oficina a un POS (Florida, Puebla, Hotel).
-- Reemplaza tener que correr un .exe por RustDesk en cada computadora: Oficina
-- deja la solicitud aqui, el POS la jala (siempre el POS inicia la conexion,
-- mismo patron que correcciones_anterior_pendientes), muestra un aviso, pide
-- el PIN de un administrador en la sucursal, hace respaldo, reinicia folios /
-- turnos / anteriores y reporta el resultado.
--
-- Solo un admin de Oficina puede crearla. Solo la Edge Function
-- `pos-reinicio-mes` (service_role) marca ejecutada/error -- el POS nunca
-- escribe aqui directo. Caduca sola (3 dias) para que no se dispare mucho
-- despues sobre datos nuevos.
create table if not exists public.reinicios_mes_pendientes (
  id uuid primary key default gen_random_uuid(),
  sucursal text not null,
  periodo text not null,               -- mes que se CIERRA, ej. '2026-09'
  turno_inicial integer not null check (turno_inicial >= 1),
  estado text not null default 'pendiente'
    check (estado in ('pendiente','ejecutada','error','cancelada','caducada')),
  creada_por text,
  creada_at timestamptz not null default now(),
  expira_at timestamptz not null default (now() + interval '3 days'),
  ejecutada_at timestamptz,
  ejecutada_por text,                  -- quien la acepto con su PIN en el POS
  resumen jsonb,                       -- que borro / conservo
  error text
);

-- Una sola solicitud pendiente por sucursal.
create unique index if not exists reinicios_mes_una_pendiente_por_sucursal
  on public.reinicios_mes_pendientes (sucursal) where estado = 'pendiente';

alter table public.reinicios_mes_pendientes enable row level security;

create policy "reinicios_mes_select" on public.reinicios_mes_pendientes
  for select to authenticated
  using (exists (select 1 from public.perfiles where id = auth.uid() and rol in ('admin','oficinista')));

create policy "reinicios_mes_insert_admin" on public.reinicios_mes_pendientes
  for insert to authenticated
  with check (
    estado = 'pendiente'
    and exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin')
  );

-- Un admin solo puede CANCELAR una pendiente (nunca marcarla ejecutada).
create policy "reinicios_mes_cancelar_admin" on public.reinicios_mes_pendientes
  for update to authenticated
  using (estado = 'pendiente' and exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin'))
  with check (estado = 'cancelada');

grant select, insert, update on public.reinicios_mes_pendientes to authenticated;
grant select, insert, update, delete on public.reinicios_mes_pendientes to service_role;
