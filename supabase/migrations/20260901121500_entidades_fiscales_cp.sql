-- CP de facturacion (Lugar de Expedicion ante el SAT) por entidad -- lo
-- necesita el Edge Function de Facturacion Global para armar el CFDI sin
-- depender de la configuracion local de cada sucursal (Fase 2: Oficina
-- factura sin necesitar que el POS de la sucursal este prendido).
alter table public.entidades_fiscales add column if not exists cp text;

update public.entidades_fiscales set cp = '93523' where entidad = 'FLO';
update public.entidades_fiscales set cp = '93320' where entidad = 'PUE';
update public.entidades_fiscales set cp = '93320' where entidad = 'HOT';
