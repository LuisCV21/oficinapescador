-- El service_role bypassa RLS pero sigue necesitando los GRANT de SQL
-- estandar sobre la tabla. Sin esto, la Edge Function recibir-corte-pos
-- (que usa service_role) se topaba con "permission denied for table
-- cortes_caja" al intentar insertar/upsert.
grant select, insert, update, delete on public.cortes_caja to service_role;
grant usage on schema public to service_role;
