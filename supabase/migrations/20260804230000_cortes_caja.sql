-- Cortes de caja diarios enviados por Pescador POS (sistema de escritorio
-- aparte, PyQt6 + SQLite local). Un turno ahi equivale a un dia completo de
-- caja de un restaurante (una cajera cubre el turno completo).
--
-- Solo la Edge Function `recibir-corte-pos` (con service_role) puede
-- insertar/actualizar aqui -- a diferencia de otras tablas del sistema, no
-- se expone insert/update/delete a usuarios autenticados desde la app,
-- porque estos datos deben venir siempre del POS, no de captura manual.
create table if not exists public.cortes_caja (
  id uuid primary key default gen_random_uuid(),
  turno_id integer not null,
  sucursal text not null,
  apertura timestamptz not null,
  cierre timestamptz,
  total_ventas numeric not null default 0,
  diferencia_cuadre numeric,
  datos jsonb not null,
  recibido_at timestamptz not null default now(),
  unique (sucursal, turno_id)
);

alter table public.cortes_caja enable row level security;

create policy "cortes_caja_select" on public.cortes_caja for select to authenticated using (true);
