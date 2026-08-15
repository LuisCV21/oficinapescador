-- La migracion original de horas_extra (20260725150000) creo las policies de
-- RLS pero se le olvido el GRANT de tabla a "authenticated" -- sin ese grant
-- base, Postgres regresa "permission denied for table horas_extra" sin
-- siquiera llegar a evaluar las policies. Se replica el mismo patron que ya
-- tiene horas_extra_semana (grant + realtime).
grant select, insert, update, delete on public.horas_extra to authenticated;

alter publication supabase_realtime add table public.horas_extra;
