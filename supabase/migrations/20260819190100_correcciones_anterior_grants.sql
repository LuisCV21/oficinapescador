-- Mismo problema que con correcciones_pago_pendientes (ver
-- 20260818120000_correcciones_pago_grants.sql): las politicas RLS son un
-- filtro adicional, no sustituyen el GRANT base de SQL.
grant select, insert, delete on public.correcciones_anterior_pendientes to authenticated;
grant select, insert, update, delete on public.correcciones_anterior_pendientes to service_role;
