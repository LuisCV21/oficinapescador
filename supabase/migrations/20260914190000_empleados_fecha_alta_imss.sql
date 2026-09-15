-- Fecha de alta ante el IMSS, aparte de la fecha de ingreso real -- en la
-- práctica casi nunca coinciden (el alta ante el IMSS suele capturarse
-- después del ingreso real), y cada una alimenta cálculos distintos:
-- fecha_ingreso sigue siendo la que se usa para vacaciones, finiquitos y
-- casi todo lo demás; fecha_alta_imss es la que debe usarse para el
-- salario base de cotización (antigüedad IMSS) al calcular la cuota obrera
-- semanal en Nómina. Nullable a propósito -- empleados ya capturados no
-- tienen este dato todavía, el cálculo de nómina cae a fecha_ingreso
-- mientras tanto (ver calcularImssSemanal en index.html).
alter table public.empleados
  add column if not exists fecha_alta_imss date;
