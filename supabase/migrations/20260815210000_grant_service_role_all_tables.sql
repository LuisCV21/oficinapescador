-- service_role deberia tener acceso total a todo el esquema public en
-- cualquier proyecto Supabase (se salta RLS, pero sigue necesitando el
-- GRANT base de la tabla -- RLS bypass no reemplaza al GRANT). Aqui solo
-- 6 de 29 tablas lo tenian; el resto (incluidas nomina_periodos,
-- nomina_lineas, empleados, puestos, facturacom_grupos) solo traian
-- REFERENCES/TRIGGER/TRUNCATE. Esto rompia en silencio cualquier Edge
-- Function que use la llave de servicio (timbrar-nomina, crear-usuario,
-- recibir-corte-pos) contra esas tablas, con un generico "permission
-- denied" que no decia cual era la causa real.
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
