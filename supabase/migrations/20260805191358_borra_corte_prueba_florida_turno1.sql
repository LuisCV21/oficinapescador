-- Borra un corte de PRUEBA enviado por accidente desde Pescador POS al probar
-- el secreto compartido recien rotado (datos de un ejercicio de práctica,
-- turno_id=1 con saldos ficticios recreados de una hoja de papel, no una
-- venta real). Delete acotado por sucursal+turno_id para no tocar cortes reales.
delete from public.cortes_caja
where sucursal = 'Florida' and turno_id = 1;
