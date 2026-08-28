-- Control de Gastos: cuando alguien corrige a mano la columna del Excel a
-- la que pertenece un gasto de mercancia/diverso capturado en el corte del
-- POS (el clasificador por palabras clave adivina, pero no siempre acierta),
-- la correccion se guarda aqui para ese gasto puntual (identificado por
-- sucursal+turno_id+la fecha exacta del movimiento, que ya es unica dentro
-- de un turno) -- no es un diccionario global, cada gasto se corrige aparte.
-- fecha se guarda TAL CUAL como texto (no timestamptz): es el mismo string
-- que ya trae movimientos_desglose desde el POS (sin zona horaria) y se usa
-- solo para emparejar por igualdad exacta contra ese campo -- convertirlo a
-- timestamptz aqui lo normalizaria a UTC y ya no haria match en el frontend.
create table public.gastos_clasificacion_overrides (
  id uuid primary key default gen_random_uuid(),
  sucursal text not null,
  turno_id integer not null,
  fecha text not null,
  categoria_final text not null,
  creado_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(sucursal, turno_id, fecha)
);

alter table public.gastos_clasificacion_overrides enable row level security;

create policy "gco_select" on public.gastos_clasificacion_overrides for select to authenticated using (true);
create policy "gco_insert" on public.gastos_clasificacion_overrides for insert to authenticated with check (true);
create policy "gco_update" on public.gastos_clasificacion_overrides for update to authenticated using (true) with check (true);
create policy "gco_delete" on public.gastos_clasificacion_overrides for delete to authenticated using (true);

grant select, insert, update, delete on public.gastos_clasificacion_overrides to authenticated;

alter publication supabase_realtime add table public.gastos_clasificacion_overrides;
