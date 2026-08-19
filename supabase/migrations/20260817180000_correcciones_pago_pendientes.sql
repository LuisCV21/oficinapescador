-- Correcciones de metodo de pago que Oficina detecta revisando los folios de
-- un corte (ej. "este folio dice Efectivo pero en realidad fue Debito") y
-- que Pescador POS (sistema de escritorio aparte) debe jalar y aplicar el
-- solo, sin que Oficina le hable directo -- el POS no tiene servidor
-- expuesto a internet, siempre es el POS quien inicia la conexion (mismo
-- patron que recibir-corte-pos, pero al reves: aqui el POS hace GET/POST).
--
-- Solo la Edge Function `pos-correcciones-pago` (con service_role) puede
-- marcar como aplicada -- el POS nunca actualiza esta tabla directo, para
-- que quede claro en el historial cuando de verdad se aplico del lado del
-- restaurante (aplicada_at) vs cuando Oficina la creo (creada_at).
create table if not exists public.correcciones_pago_pendientes (
  id uuid primary key default gen_random_uuid(),
  sucursal text not null,
  folio integer not null,
  turno_id integer,
  forma_pago_correcta text not null,
  motivo text,
  creada_por text,
  creada_at timestamptz not null default now(),
  aplicada boolean not null default false,
  aplicada_at timestamptz
);

create index if not exists correcciones_pago_pendientes_sucursal_pendientes_idx
  on public.correcciones_pago_pendientes (sucursal)
  where not aplicada;

alter table public.correcciones_pago_pendientes enable row level security;

-- Oficina (usuarios logueados en el SPA) puede ver todo, crear correcciones
-- nuevas, y cancelar (borrar) las que todavia no se hayan aplicado --
-- una vez aplicada queda como registro historico, no se borra ni edita.
create policy "correcciones_pago_select" on public.correcciones_pago_pendientes
  for select to authenticated using (true);

create policy "correcciones_pago_insert" on public.correcciones_pago_pendientes
  for insert to authenticated with check (not aplicada);

create policy "correcciones_pago_delete_pendiente" on public.correcciones_pago_pendientes
  for delete to authenticated using (not aplicada);
