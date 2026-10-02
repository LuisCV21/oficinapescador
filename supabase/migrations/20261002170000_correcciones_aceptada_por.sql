-- Quien firmo (PIN) la aceptacion de la correccion en la sucursal.
alter table correcciones_pago_pendientes add column if not exists aceptada_por text;
alter table correcciones_anterior_pendientes add column if not exists aceptada_por text;
