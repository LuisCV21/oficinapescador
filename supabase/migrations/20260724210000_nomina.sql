-- Sueldo diario por empleado y sugerido por puesto
alter table public.empleados add column salario_diario numeric(10,2);
alter table public.puestos add column salario_sugerido numeric(10,2);

-- Una corrida de nomina semanal por sucursal
create table public.nomina_periodos (
  id uuid primary key default gen_random_uuid(),
  entidad text not null,
  semana_inicio date not null,
  semana_fin date not null,
  fecha_pago date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(entidad, semana_inicio)
);

-- Una linea por empleado dentro de esa corrida
create table public.nomina_lineas (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references public.nomina_periodos(id) on delete cascade,
  empleado_id uuid not null references public.empleados(id),
  dia_descanso text,
  dias_trabajados integer not null default 0,
  dias_pagados integer not null default 0,
  salario_diario numeric(10,2) not null default 0,
  trabajo_domingo boolean not null default false,
  retencion_isr numeric(10,2) not null default 0,
  retencion_imss numeric(10,2) not null default 0,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(periodo_id, empleado_id)
);

alter table public.nomina_periodos enable row level security;
alter table public.nomina_lineas enable row level security;

create policy "nomina_periodos_select" on public.nomina_periodos for select to authenticated using (true);
create policy "nomina_periodos_insert" on public.nomina_periodos for insert to authenticated with check (true);
create policy "nomina_periodos_update" on public.nomina_periodos for update to authenticated using (true) with check (true);
create policy "nomina_periodos_delete" on public.nomina_periodos for delete to authenticated using (true);

create policy "nomina_lineas_select" on public.nomina_lineas for select to authenticated using (true);
create policy "nomina_lineas_insert" on public.nomina_lineas for insert to authenticated with check (true);
create policy "nomina_lineas_update" on public.nomina_lineas for update to authenticated using (true) with check (true);
create policy "nomina_lineas_delete" on public.nomina_lineas for delete to authenticated using (true);

grant select, insert, update, delete on public.nomina_periodos to authenticated;
grant select, insert, update, delete on public.nomina_lineas to authenticated;

alter publication supabase_realtime add table public.nomina_periodos;
alter publication supabase_realtime add table public.nomina_lineas;
