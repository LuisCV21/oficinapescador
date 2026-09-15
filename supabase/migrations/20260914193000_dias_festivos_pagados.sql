-- Registro de días festivos trabajados y pagados a un empleado -- por ley
-- se paga doble ADEMÁS del salario normal de ese día (que el empleado ya
-- cobra en su nómina semanal de siempre), así que cada fila aquí es solo
-- ese doble extra, y genera su propio recibo impreso con firma (1 recibo
-- por cada día festivo, no uno consolidado -- a diferencia de horas_extra,
-- que sí junta toda la semana en un solo recibo).
create table if not exists public.dias_festivos_pagados (
  id uuid primary key default gen_random_uuid(),
  empleado_id uuid not null references public.empleados(id) on delete cascade,
  entidad text not null check (entidad in ('HOT','PUE','FLO')),
  fecha date not null,
  concepto text,
  salario_diario numeric not null,
  impreso boolean not null default false,
  creado_por uuid references auth.users(id),
  created_at timestamptz default now(),
  unique(empleado_id, fecha)
);

alter table public.dias_festivos_pagados enable row level security;

create policy "dias_festivos_pagados_select" on public.dias_festivos_pagados for select to authenticated using (true);
create policy "dias_festivos_pagados_insert" on public.dias_festivos_pagados for insert to authenticated with check (true);
create policy "dias_festivos_pagados_update" on public.dias_festivos_pagados for update to authenticated using (true) with check (true);
create policy "dias_festivos_pagados_delete" on public.dias_festivos_pagados for delete to authenticated using (true);
