-- "Impreso" (se generó el recibo) y "pagado" (ya se le entregó el dinero al
-- empleado) son dos cosas distintas -- a veces no se pagan los 2 días
-- festivos de golpe, uno se liquida hoy y el otro después, y hace falta que
-- quede registrado cuál de los dos ya se pagó de verdad (no solo cuál ya se
-- imprimió).
alter table public.dias_festivos_pagados
  add column if not exists pagado boolean not null default false,
  add column if not exists pagado_at timestamptz;
