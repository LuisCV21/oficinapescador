-- Domicilio del trabajador, necesario para la declaracion del contrato
-- (antes quedaba siempre en blanco porque no existia el campo).
alter table public.empleados add column if not exists domicilio text;
