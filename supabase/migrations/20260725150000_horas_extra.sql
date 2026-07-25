-- Modulo de control de horas extra y retardos: una fila por empleado/dia,
-- igual de granular que asistencia pero independiente (no toda falta/HE
-- coincide con un registro de asistencia).
create table if not exists public.horas_extra (
  id uuid primary key default gen_random_uuid(),
  empleado_id uuid not null references public.empleados(id) on delete cascade,
  fecha date not null,
  entidad text not null check (entidad in ('HOT','PUE','FLO')),
  he integer not null default 0,
  rt integer not null default 0,
  creado_por uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(empleado_id, fecha)
);

alter table public.horas_extra enable row level security;

create policy "horas_extra_select" on public.horas_extra for select to authenticated using (true);
create policy "horas_extra_insert" on public.horas_extra for insert to authenticated with check (true);
create policy "horas_extra_update" on public.horas_extra for update to authenticated using (true) with check (true);
create policy "horas_extra_delete" on public.horas_extra for delete to authenticated using (true);
