-- Deduplica puestos que son el mismo trabajo con distinta capitalización
-- (p.ej. "Encargada" vs "ENCARGADA"), quedándose con la mejor capitalizada.
create temporary table puesto_merge as
select id, nombre, orden,
       first_value(id) over (partition by lower(nombre) order by orden) as keep_id,
       first_value(nombre) over (partition by lower(nombre) order by orden) as keep_nombre
from public.puestos;

update public.empleados e
set puesto = m.keep_nombre
from puesto_merge m
where e.puesto = m.nombre and m.id <> m.keep_id;

delete from public.puestos p
using puesto_merge m
where p.id = m.id and m.id <> m.keep_id;

drop table puesto_merge;

-- Enlaza empleados.puesto -> puestos.id por FK, para que renombrar un puesto
-- en Configuración se refleje automáticamente en todos los empleados que lo usan.
alter table public.empleados add column puesto_id uuid references public.puestos(id);
update public.empleados e set puesto_id = p.id from public.puestos p where p.nombre = e.puesto;
alter table public.empleados drop column puesto;

-- Enlaza pagos.banco -> cuentas_pago.id por FK, para que renombrar una cuenta
-- en Configuración se refleje automáticamente en el historial de pagos.
alter table public.pagos add column banco_id uuid references public.cuentas_pago(id);
update public.pagos pg set banco_id = c.id from public.cuentas_pago c where c.nombre = pg.banco;
alter table public.pagos drop column banco;
