-- Bucket privado para los PDFs de corte que manda Pescador POS. Privado
-- (no public) porque trae cifras de venta del restaurante -- el frontend
-- pide una signed URL de corta duracion cuando el usuario da "Ver PDF",
-- en vez de exponer una URL publica permanente.
insert into storage.buckets (id, name, public)
values ('cortes-pdf', 'cortes-pdf', false)
on conflict (id) do nothing;

alter table public.cortes_caja add column if not exists pdf_path text;

-- Igual que con cortes_caja: solo service_role sube (la Edge Function),
-- authenticated solo lee (para poder generar su signed URL).
create policy "cortes_pdf_select_authenticated" on storage.objects
  for select to authenticated
  using (bucket_id = 'cortes-pdf');

grant select on storage.objects to authenticated;
grant select, insert, update, delete on storage.objects to service_role;
