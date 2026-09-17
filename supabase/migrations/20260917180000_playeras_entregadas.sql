-- Control de playeras/uniforme entregado a cada empleado -- quién tiene,
-- talla, cuántas y cuándo se le entregaron. Pedido del dueño, 17-sept-2026,
-- para el módulo de Recursos Humanos ("un botón que me muestre en general
-- quiénes tienen playeras, cuándo se les entregó"). Mismo patrón que
-- dias_festivos_pagados: una fila por entrega, no un contador editable, así
-- queda el historial completo de cuándo se entregó cada una.
create table if not exists public.playeras_entregadas (
  id uuid primary key default gen_random_uuid(),
  empleado_id uuid not null references public.empleados(id) on delete cascade,
  entidad text not null check (entidad in ('HOT','PUE','FLO')),
  talla text,
  cantidad integer not null default 1,
  fecha_entrega date not null,
  notas text,
  creado_por uuid references auth.users(id),
  created_at timestamptz default now()
);

create index if not exists playeras_entregadas_empleado_idx
  on public.playeras_entregadas (empleado_id);

alter table public.playeras_entregadas enable row level security;

create policy "playeras_entregadas_select" on public.playeras_entregadas for select to authenticated using (true);
create policy "playeras_entregadas_insert" on public.playeras_entregadas for insert to authenticated with check (true);
create policy "playeras_entregadas_update" on public.playeras_entregadas for update to authenticated using (true) with check (true);
create policy "playeras_entregadas_delete" on public.playeras_entregadas for delete to authenticated using (true);
