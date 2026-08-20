-- Soporte para cancelar y sustituir un CFDI de nomina ya timbrado por error
-- (ej. el bug del subsidio al empleo duplicado, ver commit que corrige
-- timbrar-nomina). factura.com pide, para cancelar, el "uid" de item (no el
-- uid del grupo ni el UUID del CFDI) -- se guarda para no tener que
-- recalcularlo cada vez. Tambien se guarda un rastro de la sustitucion:
-- el UUID que quedo cancelado y cuando se hizo el reemplazo.
alter table public.nomina_lineas add column if not exists facturacom_item_uid text;
alter table public.nomina_lineas add column if not exists facturacom_uuid_anterior text;
alter table public.nomina_lineas add column if not exists facturacom_sustituido_en timestamptz;

-- Estado intermedio mientras se timbra el CFDI sustituto y antes de cancelar
-- el original: se guardan aparte para no perder el original si algo falla
-- a medio camino (ej. se cae la conexion despues de timbrar el sustituto
-- pero antes de cancelar el viejo -- un reintento debe poder retomar desde
-- aqui sin timbrar un sustituto duplicado).
alter table public.nomina_lineas add column if not exists facturacom_sustituto_nomina_uid text;
alter table public.nomina_lineas add column if not exists facturacom_sustituto_item_uid text;
alter table public.nomina_lineas add column if not exists facturacom_sustituto_uuid text;
