-- Limpia el registro de prueba insertado al probar el despliegue de
-- pos-registrar-accion (folio 999999, usuario "Claude-test") -- no es un
-- cambio real, no debe salirle a Oficina como notificacion.
delete from public.acciones_pos_directas
where usuario = 'Claude-test' and detalle = 'prueba end-to-end';
