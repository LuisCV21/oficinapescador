-- El hotel tiene su propio modelo de 4 cuentas (Vales Sr. Antonio / Vales
-- del Personal / Bodega / Baucher, ver hotel-sistema/src/caja/corte_recepcion.py)
-- distinto al de Puebla/Florida (caja/bodega/vales/baucher) -- no tiene un
-- "anterior_caja" en esta cadena (su efectivo se maneja aparte, por
-- monto_apertura de cada turno). Se agregan las 2 columnas que le faltan
-- para poder dejarle correcciones de anterior igual que a los restaurantes;
-- anterior_caja se vuelve opcional (el hotel simplemente no la usa).
alter table public.correcciones_anterior_pendientes
  add column if not exists anterior_vales_antonio numeric,
  add column if not exists anterior_vales_personal numeric;

alter table public.correcciones_anterior_pendientes
  alter column anterior_caja drop not null;
