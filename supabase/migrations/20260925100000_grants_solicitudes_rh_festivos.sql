-- solicitudes_rh (18-sept) y dias_festivos_pagados (14-sept) se crearon sin
-- GRANT para `authenticated`, así que cualquier consulta desde la app daba
-- "permission denied for table ..." antes siquiera de llegar a las políticas
-- RLS (oficinistas no podían solicitar vacaciones, 25-sept-2026). Las
-- políticas ya existentes siguen siendo el candado real (p. ej. solo admin
-- puede aceptar/rechazar solicitudes).
grant select, insert, update, delete on public.solicitudes_rh to authenticated;
grant select, insert, update, delete on public.dias_festivos_pagados to authenticated;
