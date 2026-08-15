-- Toggle por empleado: si es false, esa persona no entra al timbrado real
-- (CFDI via factura.com) aunque sí se le siga pagando -- recibe un recibo
-- simple (igual que el de horas extra) con su salario semanal calculado,
-- en vez de un CFDI.
alter table public.empleados add column if not exists nomina_fiscal boolean not null default true;
