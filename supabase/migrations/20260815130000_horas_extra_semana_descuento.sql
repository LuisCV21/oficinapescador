-- Descuento semanal por empleado (ej. abono a prestamo), simetrico a la
-- bonificacion que ya existia: monto + motivo, se repite semana con semana
-- hasta que lo cambien a mano, y se resta en el recibo de horas extra.
alter table public.horas_extra_semana add column if not exists descuento numeric(10,2) not null default 0;
alter table public.horas_extra_semana add column if not exists descuento_concepto text;
