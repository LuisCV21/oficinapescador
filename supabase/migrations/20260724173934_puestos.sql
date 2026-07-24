create table public.puestos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  activa boolean not null default true,
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.puestos enable row level security;

create policy "puestos_select" on public.puestos
  for select to authenticated using (true);

create policy "puestos_insert" on public.puestos
  for insert to authenticated with check (true);

create policy "puestos_update" on public.puestos
  for update to authenticated using (true) with check (true);

insert into public.puestos (nombre, orden)
select distinct trim(puesto), row_number() over (order by trim(puesto))
from public.empleados
where puesto is not null and trim(puesto) <> ''
on conflict (nombre) do nothing;

alter publication supabase_realtime add table public.puestos;
