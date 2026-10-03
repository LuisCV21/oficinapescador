-- Solicitudes de corrección de factura que el RESTAURANTE (Pescador POS) le
-- manda a Oficina cuando el turno del folio ya cerró -- a partir de ahí el POS
-- ya no puede cancelar/sustituir por su cuenta (pedido del dueño, 3-oct-2026:
-- "una vez terminado el día pues ya no pueda moverle nada").
--
-- Cada solicitud trae el arreglo completo: qué datos fiscales tenía la factura
-- (datos_originales), cuáles deben quedar (datos_corregidos) y la lista campo
-- por campo de lo que cambia (cambios), para que Oficina no tenga que volver a
-- buscar el WhatsApp donde lo pidieron. Oficina la atiende con el flujo ya
-- existente (cancelar-cfdi / timbrar_sustituto); al terminar el POS recibe el
-- resultado por acciones_venta_pendientes ('cancelacion_directa') como siempre.
-- Esta tabla solo lleva el estado de la solicitud en sí.
--
-- Mismo patrón de conexión que las demás: el POS siempre inicia (Edge
-- Function pos-solicitudes-factura, header x-pos-secret).
create table if not exists public.solicitudes_factura (
  id uuid primary key default gen_random_uuid(),
  sucursal text not null,
  folio integer not null,
  turno_id integer,
  uuid_fiscal text,
  folio_pac text,
  tipo text not null check (tipo in ('sustitucion', 'cancelacion')),
  motivo_sat text check (motivo_sat in ('01', '02', '03', '04')),
  datos_originales jsonb not null default '{}'::jsonb,
  datos_corregidos jsonb not null default '{}'::jsonb,
  cambios jsonb not null default '[]'::jsonb,   -- [{campo, etiqueta, antes, despues}]
  nota text,
  solicitada_por text,
  solicitada_at timestamptz not null default now(),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'lista', 'rechazada', 'retirada')),
  resuelta_at timestamptz,
  resuelta_por text,
  motivo_rechazo text,
  visto_por_pos boolean not null default false
);

-- Una sola solicitud viva por folio: evita que dos cajeros manden la misma.
create unique index if not exists solicitudes_factura_una_pendiente_idx
  on public.solicitudes_factura (sucursal, folio)
  where estado = 'pendiente';

create index if not exists solicitudes_factura_sucursal_idx
  on public.solicitudes_factura (sucursal, solicitada_at desc);

alter table public.solicitudes_factura enable row level security;

-- Oficina (authenticated) lee todo y actualiza estado; el POS escribe solo
-- por la Edge Function (service_role). Oficina no crea solicitudes.
create policy "solicitudes_factura_select" on public.solicitudes_factura
  for select to authenticated using (true);

create policy "solicitudes_factura_update" on public.solicitudes_factura
  for update to authenticated using (true) with check (true);

-- Grants base de SQL: las policies de RLS no los sustituyen (ver
-- 20260818120000_correcciones_pago_grants.sql).
grant select, update on public.solicitudes_factura to authenticated;
grant select, insert, update on public.solicitudes_factura to service_role;
