-- Mismo problema que ya paso con cortes_caja (ver
-- 20260805000000_cortes_caja_grants.sql / 20260805010000_..._authenticated):
-- las politicas RLS son un filtro adicional, no sustituyen el GRANT base de
-- SQL. Sin esto, tanto el SPA (authenticated) como la Edge Function
-- pos-correcciones-pago (service_role) se topaban con "permission denied
-- for table correcciones_pago_pendientes" al intentar insertar/leer/marcar
-- como aplicada.
grant select, insert, delete on public.correcciones_pago_pendientes to authenticated;
grant select, insert, update, delete on public.correcciones_pago_pendientes to service_role;
