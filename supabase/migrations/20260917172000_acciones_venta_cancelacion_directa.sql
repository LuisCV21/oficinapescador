-- Agrega el tercer tipo 'cancelacion_directa' a acciones_venta_pendientes:
-- a diferencia de 'cancelacion'/'sustitucion' (que dejan una SOLICITUD para
-- que la sucursal la confirme y ejecute ante el SAT con DialogoCancelarFactura,
-- ver 20260829120000_acciones_venta_pendientes.sql), este tipo se usa cuando
-- Oficina YA canceló/sustituyó el CFDI directo (ver cancelar-cfdi/index.ts,
-- decisión del dueño 2026-09-01) -- Pescador POS / hotel-sistema solo
-- necesitan reflejarlo en su base local (marcar cancelada + dar de alta el
-- sustituto si lo hay), sin volver a tocar el SAT ni pedir PIN de
-- autorización. Pedido del dueño, 17-sept-2026: "a fin de cuentas ellos
-- serán los que terminen enviándosela al cliente".
--
-- Las columnas nuevas traen ya calculados los mismos datos que
-- facturas_individuales guarda del sustituto (ver timbrar_sustituto en
-- oficina-facturacion-global/index.ts), para que el POS pueda dar de alta
-- la factura sustituta completa sin tener que volver a consultar nada.

alter table public.acciones_venta_pendientes drop constraint acciones_venta_pendientes_tipo_check;
alter table public.acciones_venta_pendientes add constraint acciones_venta_pendientes_tipo_check
  check (tipo in ('cancelacion', 'sustitucion', 'cancelacion_directa'));

alter table public.acciones_venta_pendientes
  add column if not exists uuid_original text,
  add column if not exists uuid_sustituto text,
  add column if not exists folio_pac_sustituto text,
  add column if not exists rfc_receptor text,
  add column if not exists razon_social text,
  add column if not exists regimen_fiscal text,
  add column if not exists uso_cfdi text,
  add column if not exists cp_receptor text,
  add column if not exists email_receptor text,
  add column if not exists subtotal numeric,
  add column if not exists iva numeric,
  add column if not exists total numeric,
  add column if not exists metodo_pago text,
  add column if not exists forma_pago text;
