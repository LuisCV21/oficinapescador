-- Apartado de Garantías: las chicas de oficina suben el ticket y la póliza
-- de garantía de cada producto que se compra (refri, licuadora, TV...), para
-- que cuando algo falle solo lo busquen por nombre del producto y ya tengan
-- el ticket a la mano. Pedido de la hermana del dueño, 28-sept-2026.
--
-- Una garantía = un producto comprado; sus archivos (ticket, póliza,
-- factura, fotos) van en garantias_archivos + bucket privado `garantias`.
create table if not exists public.garantias (
  id uuid primary key default gen_random_uuid(),
  producto text not null,
  marca text,
  modelo text,
  num_serie text,
  tienda text,
  entidad text check (entidad in ('HOT','PUE','FLO','OBR','OFI','PER','CEN')),
  fecha_compra date,
  vence_garantia date,
  monto numeric(12,2),
  notas text,
  registrado_por uuid references auth.users(id),
  registrado_por_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists garantias_producto_idx on public.garantias (lower(producto));

create table if not exists public.garantias_archivos (
  id uuid primary key default gen_random_uuid(),
  garantia_id uuid not null references public.garantias(id) on delete cascade,
  tipo text not null default 'otro' check (tipo in ('ticket','poliza','factura','foto','otro')),
  nombre_archivo text not null,
  storage_path text not null,
  size_bytes bigint,
  mime_type text,
  created_at timestamptz not null default now()
);

create index if not exists garantias_archivos_garantia_idx on public.garantias_archivos (garantia_id);

alter table public.garantias enable row level security;
alter table public.garantias_archivos enable row level security;

-- Cualquier cuenta de Oficina puede ver, registrar y corregir; borrar
-- (el registro o sus archivos) solo admin, para que no se pierda un ticket
-- por accidente.
create policy "garantias_select" on public.garantias
  for select to authenticated using (true);
create policy "garantias_insert" on public.garantias
  for insert to authenticated with check (true);
create policy "garantias_update" on public.garantias
  for update to authenticated using (true) with check (true);
create policy "garantias_delete_admin" on public.garantias
  for delete to authenticated using (
    exists(select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'admin')
  );

create policy "garantias_archivos_select" on public.garantias_archivos
  for select to authenticated using (true);
create policy "garantias_archivos_insert" on public.garantias_archivos
  for insert to authenticated with check (true);
create policy "garantias_archivos_delete_admin" on public.garantias_archivos
  for delete to authenticated using (
    exists(select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'admin')
  );

-- Sin esto da "permission denied" antes de llegar a RLS (ver
-- 20260925100000_grants_solicitudes_rh_festivos.sql).
grant select, insert, update, delete on public.garantias to authenticated;
grant select, insert, update, delete on public.garantias_archivos to authenticated;

-- Bucket privado (se abre con URL firmada, igual que pagos/vehiculos).
insert into storage.buckets (id, name, public)
values ('garantias', 'garantias', false)
on conflict (id) do nothing;

create policy "garantias_storage_select" on storage.objects
  for select to authenticated using (bucket_id = 'garantias');
create policy "garantias_storage_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'garantias');
create policy "garantias_storage_delete_admin" on storage.objects
  for delete to authenticated using (
    bucket_id = 'garantias'
    and exists(select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'admin')
  );
