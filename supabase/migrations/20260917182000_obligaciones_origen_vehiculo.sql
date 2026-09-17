-- Vincula los documentos de Flotilla con vencimiento (seguro/tenencia/
-- verificación) a Obligaciones -- pedido del dueño, 17-sept-2026: "la
-- mayoría de esos trámites tienen su vencimiento y hay que ponerlo ahí".
--
-- origen_tabla/origen_clave marcan una obligación como sincronizada
-- automáticamente desde otro módulo (hoy solo Flotilla, 'vehiculo:<id>:
-- <tipo>' -- ver sincronizarObligacionVehiculo en index.html). El índice
-- único parcial permite hacer upsert(on_conflict:'origen_clave') sin
-- duplicar la obligación cada vez que se reemplaza el documento.
alter table public.obligaciones
  add column if not exists origen_tabla text,
  add column if not exists origen_clave text;

create unique index if not exists obligaciones_origen_clave_key
  on public.obligaciones (origen_clave)
  where origen_clave is not null;

-- Categoría nueva para que estas obligaciones no se mezclen con "Seguros"
-- (que ya se usaba para pólizas del negocio, no de los vehículos) ni con
-- "Trámites Ayuntamiento".
insert into public.obl_categorias (clave, label, icono, color, tipo, orden, activa)
values ('vehiculo', 'Vehículos', '🚗', '#e67e22', 'recurrente', 9, true)
on conflict (clave) do nothing;
