-- La política RLS "cortes_caja_select" ya permitía leer a "authenticated",
-- pero le faltaba el GRANT SELECT de SQL estándar (RLS es un filtro
-- adicional, no sustituye el permiso base). Por eso el navegador logueado
-- no veía ningún corte aunque la Edge Function sí insertaba correctamente.
grant select on public.cortes_caja to authenticated;
