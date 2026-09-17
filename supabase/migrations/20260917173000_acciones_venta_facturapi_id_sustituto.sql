-- Faltaba facturapi_id (el UID interno de Factura.com, distinto del UUID
-- fiscal) en el aviso de cancelacion_directa -- Pescador POS/hotel-sistema
-- lo necesitan guardado localmente para poder cancelar/consultar ESA
-- factura sustituta despues (es el campo que ya usan como cfdi_uid al
-- llamar cancelar_factura, ver dialogo_acciones.py::_ejecutar alla).
alter table public.acciones_venta_pendientes
  add column if not exists facturapi_id_sustituto text;
