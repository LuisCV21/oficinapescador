-- Las dos policies de perfiles decian "to public" (cualquiera, con sesion o
-- sin ella) en vez de "to authenticated" -- en la practica is_admin() ya
-- valida auth.uid() por dentro asi que un anonimo de todos modos recibia
-- cero filas, pero declararlas "to public" deja la puerta abierta a que un
-- cambio futuro en is_admin() (o una nueva policy) rompa esa proteccion sin
-- que la restriccion de rol lo detenga. Se corrige a "authenticated"
-- explicito, mismo patron que el resto del proyecto -- no cambia el
-- comportamiento actual, solo lo hace robusto ante cambios futuros.
drop policy if exists "perfiles_select_own_or_admin" on public.perfiles;
create policy "perfiles_select_own_or_admin" on public.perfiles
  for select to authenticated
  using ((auth.uid() = id) OR is_admin());

drop policy if exists "perfiles_update_admin_only" on public.perfiles;
create policy "perfiles_update_admin_only" on public.perfiles
  for update to authenticated
  using (is_admin());
