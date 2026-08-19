-- Correcciones de los saldos "anterior" (caja/bodega/vales/baucher) que
-- Oficina deja pendientes cuando una sucursal se equivoca capturando su
-- corte -- para no tener que ir en persona a corregirlo en el POS. Igual
-- que correcciones_pago_pendientes: el POS (sistema de escritorio aparte,
-- sin servidor expuesto) siempre inicia la conexion, aqui via GET/POST.
--
-- A diferencia de un folio de pago (que ya existe y solo se corrige), aqui
-- no hay "turno_id" todavia cuando Oficina la crea -- se aplica al
-- PROXIMO turno que la sucursal abra (o al turno ya abierto, si hay uno).
-- turno_id_aplicado se llena hasta que el POS de verdad la aplica, para
-- que quede trazable a que turno correspondio.
--
-- Solo la Edge Function `pos-correcciones-anterior` (con service_role)
-- puede marcar como aplicada -- el POS nunca actualiza esta tabla directo.
create table if not exists public.correcciones_anterior_pendientes (
  id uuid primary key default gen_random_uuid(),
  sucursal text not null,
  anterior_caja numeric not null,
  anterior_bodega numeric not null default 0,
  anterior_vales numeric not null default 0,
  anterior_baucher numeric not null default 0,
  motivo text,
  creada_por text,
  creada_at timestamptz not null default now(),
  aplicada boolean not null default false,
  aplicada_at timestamptz,
  turno_id_aplicado integer
);

create index if not exists correcciones_anterior_pendientes_sucursal_pendientes_idx
  on public.correcciones_anterior_pendientes (sucursal)
  where not aplicada;

alter table public.correcciones_anterior_pendientes enable row level security;

create policy "correcciones_anterior_select" on public.correcciones_anterior_pendientes
  for select to authenticated using (true);

create policy "correcciones_anterior_insert" on public.correcciones_anterior_pendientes
  for insert to authenticated with check (not aplicada);

create policy "correcciones_anterior_delete_pendiente" on public.correcciones_anterior_pendientes
  for delete to authenticated using (not aplicada);
