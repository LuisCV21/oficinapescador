-- Auditoria de cancelaciones de CFDI ejecutadas DIRECTO desde Oficina (Edge
-- Function cancelar-cfdi, con las llaves de facturacom_credenciales) -- a
-- diferencia de acciones_venta_pendientes (que solo deja una SOLICITUD para
-- que alguien en la sucursal la confirme con PIN antes de tocar el SAT),
-- esto ya toco el SAT en el momento en que se guarda esta fila. Decision
-- explicita del dueno, 2026-09-01: Oficina puede cancelar de una vez, sin
-- pasar por el POS local.
--
-- OJO: esto NO actualiza sola facturas.estado en la base local de
-- Pescador POS / hotel-sistema -- ese reconcilio hacia el POS todavia no
-- esta construido, asi que el registro local de la sucursal puede seguir
-- marcando el folio como vigente hasta que alguien lo corrija ahi o se
-- construya el sync de vuelta.
create table if not exists public.cfdi_cancelaciones (
  id uuid primary key default gen_random_uuid(),
  entidad text not null check (entidad in ('HOT','PUE','FLO')),
  sucursal text,
  folio integer,
  turno_id integer,
  uuid_fiscal text not null,
  cfdi_uid text,
  motivo text not null check (motivo in ('01','02','03','04')),
  folio_sustituto text,
  respuesta_factura_com jsonb,
  cancelado_por uuid references auth.users(id),
  cancelado_at timestamptz not null default now()
);

create index if not exists cfdi_cancelaciones_uuid_idx on public.cfdi_cancelaciones (uuid_fiscal);

alter table public.cfdi_cancelaciones enable row level security;

-- Mismo criterio que facturas_globales: admin/oficinista pueden ver el
-- historial, pero solo el Edge Function (service_role) inserta -- nunca se
-- expone insert/update/delete a la sesion del navegador.
create policy "cfdi_cancelaciones_select" on public.cfdi_cancelaciones
  for select to authenticated
  using (exists (select 1 from public.perfiles where id = auth.uid() and rol in ('admin','oficinista')));

grant select on public.cfdi_cancelaciones to authenticated;
