-- Carga inicial de uniformes (playeras/mandiles) de Hotel y Puebla desde
-- "RELACION DE PLAYERAS Y MANDILES HOTEL Y PUEBLA.xlsx" (24-sept-2026).
-- El color va en observaciones como ya se hacía a mano ("COLOR VINO").
-- Los mandiles no traen talla en el Excel y la columna es NOT NULL -> 'UNITALLA'.
-- Omitida: playera de Nancy Cortes Villalvazo del 2026-09-10 (ya estaba capturada).
-- Maria Magdalena Villanueva Santes aparece en la hoja de Puebla pero su
-- expediente está en FLO; se registra igual en su expediente.
insert into public.uniformes (empleado_id, tipo, talla, cantidad, fecha_entrega, observaciones)
select e.id, v.tipo, v.talla, v.cantidad, v.fecha::date, v.obs
from (values
  -- PUEBLA
  ('Cecilia Reyes Jimenez',              'playera','M',       1,'2026-02-14','COLOR VINO'),
  ('Dulce Estephany Ramírez San Martín', 'playera','M',       2,'2026-06-03','COLOR VINO'),
  ('Alejandra Vazquez Sanchez',          'playera','M',       2,'2026-06-03','COLOR VINO'),
  ('Guillermina Cruz Garrido',           'mandil', 'UNITALLA',1,'2024-09-07',null),
  ('Maria Magdalena Villanueva Santes',  'mandil', 'UNITALLA',1,'2024-09-07',null),
  ('Maria Yazmin Hernandez Campero',     'mandil', 'UNITALLA',1,'2024-09-07',null),
  ('Maria Magdalena Villanueva Santes',  'playera','M',       1,'2024-10-26','COLOR VINO'),
  ('Ana Nohemi Arriaga Lopez',           'playera','M',       1,'2026-07-04','COLOR VINO'),
  ('Arely Tellez Leal',                  'playera','G',       1,'2026-04-30','COLOR VINO'),
  ('Rosario Gonzalez Barrera',           'playera','G',       1,'2026-04-30','COLOR VINO'),
  -- HOTEL
  ('Julio Martinez Hernandez',           'playera','38',      2,'2025-07-16','COLOR AZUL'),
  ('Williams Israel Vazquez Jimenez',    'playera','G',       2,'2025-12-27','COLOR NEGRO'),
  ('Mario Esteban Santillan Cortes',     'playera','G',       2,'2025-12-27','COLOR NEGRO'),
  ('Marissa Cuaxochipa Cruz',            'playera','M',       2,'2022-07-27',null),
  ('Williams Israel Vazquez Jimenez',    'playera','G',       2,'2022-07-27',null),
  ('Jannet Rodriguez Duran',             'playera','M',       2,'2022-07-27',null),
  ('Marissa Cuaxochipa Cruz',            'playera','M',       2,'2023-06-01',null),
  ('Williams Israel Vazquez Jimenez',    'playera','G',       2,'2023-06-01',null),
  ('Claudia Mallely García Gaytan',      'playera','G',       2,'2023-06-01',null),
  ('Mireli Garcia Cruz',                 'playera','CH',      2,'2023-06-01',null),
  ('Julio Martinez Hernandez',           'playera','G',       2,'2023-06-01',null),
  ('Jannet Rodriguez Duran',             'playera','G',       2,'2023-06-01',null),
  ('Liliana Garcia Flores',              'playera','M',       2,'2023-06-01',null)
) as v(nombre, tipo, talla, cantidad, fecha, obs)
join public.empleados e on e.nombre = v.nombre
where not exists (
  select 1 from public.uniformes u
  where u.empleado_id = e.id and u.tipo = v.tipo and u.fecha_entrega = v.fecha::date
);
