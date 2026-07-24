create table public.cuentas_pago (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  activa boolean not null default true,
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cuentas_pago enable row level security;

create policy "cuentas_pago_select" on public.cuentas_pago
  for select to authenticated using (true);

create policy "cuentas_pago_insert" on public.cuentas_pago
  for insert to authenticated with check (true);

create policy "cuentas_pago_update" on public.cuentas_pago
  for update to authenticated using (true) with check (true);

insert into public.cuentas_pago (nombre, orden) values
  ('Scotiabank — Puebla', 1),
  ('BBVA — Hotel', 2),
  ('Scotiabank — Florida', 3),
  ('BBVA — Florida', 4),
  ('Scotiabank — Obra', 5),
  ('Efectivo', 6),
  ('Otro', 7)
on conflict (nombre) do nothing;

alter publication supabase_realtime add table public.cuentas_pago;
