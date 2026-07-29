-- Marca si dias_pagados fue editado a mano, para que el auto-sync de nomina
-- (que recalcula dias_trabajados/trabajo_domingo cuando cambia asistencia)
-- no pise el valor que ya capturó el admin.
alter table public.nomina_lineas add column if not exists dias_pagados_manual boolean not null default false;

-- Override de tarifa de hora extra/retardo y bonificacion opcional, por
-- empleado/sucursal/semana. Si tarifa_override es null se usa el calculo
-- automatico (salario_diario/8).
create table if not exists public.horas_extra_semana (
  id uuid primary key default gen_random_uuid(),
  empleado_id uuid not null references public.empleados(id) on delete cascade,
  entidad text not null check (entidad in ('HOT','PUE','FLO')),
  semana_inicio date not null,
  tarifa_override numeric(10,2),
  bonificacion numeric(10,2) not null default 0,
  bonificacion_concepto text,
  creado_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(empleado_id, entidad, semana_inicio)
);

alter table public.horas_extra_semana enable row level security;

create policy "horas_extra_semana_select" on public.horas_extra_semana for select to authenticated using (true);
create policy "horas_extra_semana_insert" on public.horas_extra_semana for insert to authenticated with check (true);
create policy "horas_extra_semana_update" on public.horas_extra_semana for update to authenticated using (true) with check (true);
create policy "horas_extra_semana_delete" on public.horas_extra_semana for delete to authenticated using (true);

grant select, insert, update, delete on public.horas_extra_semana to authenticated;

alter publication supabase_realtime add table public.horas_extra_semana;
