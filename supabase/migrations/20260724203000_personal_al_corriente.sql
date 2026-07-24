-- Obligaciones de Personal: se tratan como pagadas este mes (julio 2026),
-- proximo vencimiento el mes siguiente. No se tocan las anuales (tenencias),
-- que ya estan correctamente en el futuro.

update public.obligaciones set fecha_limite='2026-08-11', updated_at=now()
  where id='d7ea6c47-2879-46e7-a88f-a0e145b9e2ae'; -- Alarmas — Personal

update public.obligaciones set fecha_limite='2026-08-11', updated_at=now()
  where id='a0526d93-b3ec-47a3-95d4-bef04127de5c'; -- CFE Casa Puebla

update public.obligaciones set fecha_limite='2026-08-11', updated_at=now()
  where id='b6ede8fb-ea18-4992-8706-87c581c46754'; -- CFE Huerto

update public.obligaciones set fecha_limite='2026-08-11', updated_at=now()
  where id='9c26e911-f786-49fe-8640-e22e2e0f2938'; -- CFE Oficina

update public.obligaciones set fecha_limite='2026-08-11', updated_at=now()
  where id='8dce3fa6-dbd8-48e9-b681-fc7625867f32'; -- CFE Pedro C. Rdgz

update public.obligaciones set fecha_limite='2026-08-11', updated_at=now()
  where id='6a12b2da-1421-4a2c-8597-42413fad69a9'; -- Pagos Xtrail — Obra

update public.obligaciones set fecha_limite='2026-08-04', updated_at=now()
  where id='cfdcb129-4cb2-4157-9031-de0ac4766b5b'; -- Telmex — Personal

update public.obligaciones set fecha_limite='2026-08-23', updated_at=now()
  where id='81e820ef-cc24-40c7-9e26-8d95240b7c45'; -- Totalplay 4757 — Personal

update public.obligaciones set fecha_limite='2026-08-21', updated_at=now()
  where id='06b4621b-43d0-488d-bacb-099e0cb82c6b'; -- Totalplay 5886 — Personal

update public.obligaciones set fecha_limite='2026-08-29', updated_at=now()
  where id='480890f5-8526-43ee-9c88-c656dd62ea3b'; -- Totalplay 8381 — Personal
