-- Flujo de aprobación para Vacaciones/Finiquito -- las oficinistas (rol
-- 'oficinista', no admin) ya podían calcular e imprimir estos recibos
-- directo, sin que nadie más lo autorizara. Pedido del dueño, 18-sept-2026:
-- "ellas pudieran seleccionar el empleado, luego ponerle vacaciones y ahí
-- hubiera un botón que pudieran oprimir para solicitarlo, posteriormente si
-- un admin le da que lo acepta... ya que puedan las chicas imprimirlo, pero
-- antes no". Admin sigue teniendo acceso directo sin pasar por esto (ver
-- index.html, abrirVacacionesOFiniquito).
--
-- El "update" (aceptar/rechazar) queda restringido a rol='admin' a nivel de
-- base de datos -- no solo escondiendo el botón en pantalla -- porque ahí
-- vive el candado real: cualquiera con la consola del navegador podría si
-- no reescribir el estado a mano y saltarse la aprobación.
create table if not exists public.solicitudes_rh (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('vacaciones','finiquito')),
  empleado_id uuid not null references public.empleados(id) on delete cascade,
  entidad text not null check (entidad in ('HOT','PUE','FLO')),
  datos jsonb not null default '{}'::jsonb,
  notas text,
  estado text not null default 'pendiente' check (estado in ('pendiente','aceptada','rechazada')),
  solicitado_por uuid references auth.users(id),
  solicitado_por_nombre text,
  solicitado_at timestamptz not null default now(),
  revisado_por uuid references auth.users(id),
  revisado_por_nombre text,
  revisado_at timestamptz,
  motivo_rechazo text,
  created_at timestamptz not null default now()
);

create index if not exists solicitudes_rh_empleado_idx on public.solicitudes_rh (empleado_id);
create index if not exists solicitudes_rh_estado_idx on public.solicitudes_rh (estado);

alter table public.solicitudes_rh enable row level security;

create policy "solicitudes_rh_select" on public.solicitudes_rh
  for select to authenticated using (true);

create policy "solicitudes_rh_insert" on public.solicitudes_rh
  for insert to authenticated with check (true);

-- Solo admin puede aceptar/rechazar (o corregir cualquier otro campo) --
-- el candado real del flujo, ver comentario arriba.
create policy "solicitudes_rh_update_admin" on public.solicitudes_rh
  for update to authenticated using (
    exists(select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'admin')
  ) with check (
    exists(select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'admin')
  );

create policy "solicitudes_rh_delete_admin" on public.solicitudes_rh
  for delete to authenticated using (
    exists(select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'admin')
  );
