-- Carga de uniformes de Florida desde "PLAYERAS Y MANDILES FLORIDA.xlsx"
-- (24-sept-2026). Tallas normalizadas a las del sistema: L/GDE -> G, XL -> XG.
-- Las 3 entregas del 24-ago-2026 no traen talla en el Excel -> 'SIN TALLA'.
-- Omitida: Esmeralda Perez Garcia (encargada, 2023) -- no existe en empleados.
insert into public.uniformes (empleado_id, tipo, talla, cantidad, fecha_entrega, observaciones)
select e.id, v.tipo, v.talla, v.cantidad, v.fecha::date, v.obs
from (values
  ('Ofelia Juarez Villanueva',          'playera','SIN TALLA',1,'2026-08-24','COLOR VINO'),
  ('Zain Vazquez Burgos',               'playera','SIN TALLA',1,'2026-08-24','COLOR VINO'),
  ('Yamilet Reyes Martinez',            'playera','SIN TALLA',1,'2026-08-24','COLOR VINO'),
  ('Paola Yanneth Mendoza Jimenez',     'playera','M',        1,'2026-06-12','COLOR VINO'),
  ('Esteban Hernandez Beltran',         'playera','M',        1,'2026-06-12','COLOR VINO'),
  ('Maria Elizabeth Morales Garcia',    'playera','M',        1,'2026-05-28','COLOR VINO'),
  ('Sabina Rivera Cabrera',             'playera','M',        1,'2026-05-15','COLOR VINO'),
  ('Guadalupe Ortega Quintero',         'playera','M',        1,'2026-05-15','COLOR VINO'),
  ('Maria Magdalena Villanueva Santes', 'playera','M',        1,'2026-05-15','COLOR VINO'),
  ('Patricia Jimenez Ramirez',          'playera','M',        1,'2026-05-14','COLOR VINO'),
  ('Juana Francisco Ramos',             'playera','M',        1,'2026-05-14','COLOR VINO'),
  ('Viviana Hernandez Garcia',          'playera','M',        1,'2026-05-14','COLOR VINO'),
  ('Patricia Jimenez Ramirez',          'playera','M',        1,'2024-09-24','COLOR VINO'),
  ('Esteban Hernandez Beltran',         'playera','G',        1,'2025-07-05','COLOR VINO'),
  ('Zain Vazquez Burgos',               'playera','M',        1,'2024-07-29','COLOR VINO'),
  ('Viviana Hernandez Garcia',          'mandil', 'M',        1,'2024-06-15','COLOR VINO'),
  ('Maria Elizabeth Morales Garcia',    'playera','XG',       1,'2025-04-26',null),
  ('Guadalupe Ortega Quintero',         'playera','G',        1,'2025-04-26',null),
  ('Patricia Jimenez Ramirez',          'playera','M',        1,'2025-04-26',null),
  ('Sabina Rivera Cabrera',             'playera','M',        1,'2025-04-26',null),
  ('Viviana Hernandez Garcia',          'playera','M',        1,'2025-04-26',null),
  ('Martha Vazquez Ramos',              'playera','G',        1,'2024-01-01',null),
  ('Maria Magdalena Villanueva Santes', 'playera','M',        1,'2025-02-12',null)
) as v(nombre, tipo, talla, cantidad, fecha, obs)
join public.empleados e on e.nombre = v.nombre
where not exists (
  select 1 from public.uniformes u
  where u.empleado_id = e.id and u.tipo = v.tipo and u.fecha_entrega = v.fecha::date
);
