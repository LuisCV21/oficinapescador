-- El timbrado en factura.com es asincrono y a veces tarda mas de los pocos
-- segundos que se esperaba antes de consultar el estatus (se vio un caso
-- real quedarse "En fila" en su propio panel). Se guarda el uid del lote de
-- nomina para poder volver a consultar su estatus despues sin tener que
-- volver a timbrar (evita CFDIs duplicados), y "pendiente" es un estatus
-- nuevo, distinto de "error", para no dar una falsa alarma de que fallo
-- cuando en realidad solo sigue en cola.
alter table public.nomina_lineas add column if not exists facturacom_nomina_uid text;
