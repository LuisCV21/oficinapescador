-- Folio identificador editable a mano (texto libre, admite ceros a la izquierda
-- como "014"), para que sea mas facil identificar a cada empleado.
alter table public.empleados add column if not exists folio text;
