-- Garantías: categoría (para agrupar/filtrar: cocina, refrigeración,
-- cómputo...) y ubicación (dónde está físicamente el producto: "cocina
-- Puebla", "habitación 12"...) para que sea más fácil encontrar las cosas
-- cuando crezca la lista. Las claves de categoría viven en index.html
-- (GAR_CATEGORIAS); se deja texto libre sin check para poder agregar más
-- sin migración.
alter table public.garantias add column if not exists categoria text;
alter table public.garantias add column if not exists ubicacion text;

create index if not exists garantias_categoria_idx on public.garantias (categoria);
