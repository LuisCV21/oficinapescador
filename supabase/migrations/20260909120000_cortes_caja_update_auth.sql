-- cortes_caja solo tenía SELECT para "authenticated" -- lo escribe el POS con
-- la llave de servicio (INSERT), y hasta ahora nadie necesitaba corregirlo
-- desde el navegador. El editor de cortes y la corrección de forma de pago
-- (ver index.html: guardarEdicionCorte, guardarCorreccionPago) necesitan
-- poder UPDATE esta tabla desde la sesión normal de un usuario de Oficina --
-- sin esto, cualquier intento de guardar tronaba con "permission denied for
-- table cortes_caja" (reportado 9-sept-2026 por una oficinista real).
-- Solo UPDATE, no INSERT/DELETE: crear o borrar un corte completo sigue
-- siendo exclusivo del POS/servicio.
grant update on public.cortes_caja to authenticated;

create policy cortes_caja_update_auth
  on public.cortes_caja
  for update
  to authenticated
  using (true)
  with check (true);
