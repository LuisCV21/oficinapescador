-- Puesta al día de obligaciones (Hotel / Puebla / Florida) tras revisión manual
-- con el usuario. No crea pagos: solo corrige fecha_limite, nombres, entidad,
-- categoría y activa/inactiva según lo confirmado.

-- Hotel
update public.obligaciones set fecha_limite='2026-07-27', updated_at=now()
  where id='d78103f7-9d8b-499a-9aad-5d180dca6bd6'; -- Fumigación — Hotel

update public.obligaciones set fecha_limite='2027-06-17', nombre='Limpia pública — Hotel/Puebla', updated_at=now()
  where id='7061e93c-f3c2-4e01-96df-8a8383e471ff'; -- Limpia pública — Hotel (compartida con Puebla)

update public.obligaciones set nombre='Canaco SIEM — Hotel/Puebla', updated_at=now()
  where id='69da91da-4ff0-425f-8d95-4ed01c6f0823'; -- Canaco SIEM — Hotel (compartida con Puebla)

update public.obligaciones set activa=false, updated_at=now()
  where id='debdcd94-704f-4ec8-a33e-4903baae7470'; -- Canirac seguro — Hotel (Hotel no es de Canirac)

-- NR Finance / GM Financial
update public.obligaciones set nombre='NR Finance — NP300', updated_at=now()
  where id='203e86f0-b8c2-4c8e-b3dc-69265ed6c7db'; -- antes "NR Finance — Camioneta Kateryn"

update public.obligaciones set nombre='GM Financial — Camioneta Colorado', entidad='PER', updated_at=now()
  where id='5643e81f-f27a-4aba-803d-13e69ae7a804'; -- antes "NR Finance — Camioneta Luis"

-- Puebla
update public.obligaciones set nombre='Canirac — Puebla', categoria='otro', updated_at=now()
  where id='10bfc23f-669f-40b6-b968-bdfe461b08bf'; -- Canirac seguro — Puebla (es membresía, no seguro)

update public.obligaciones set recurrencia='annual', updated_at=now()
  where id='9832e7fa-f486-4975-8ae3-a0f531977381'; -- Póliza de seguro Restaurant — BBVA (era mensual por error)

update public.obligaciones set fecha_limite='2027-05-27', updated_at=now()
  where id='cb5ac575-2aa1-4ead-a0a8-f70321c7fa32'; -- Contrato ADO — Puebla (no se paga, solo referencia)

-- Florida
update public.obligaciones set fecha_limite='2026-08-14', updated_at=now()
  where id='a60c3b1d-0006-4d48-b872-9769f5d2bfd4'; -- Totalplay 3790 — Florida

update public.obligaciones set fecha_limite='2026-08-12', updated_at=now()
  where id='dbbd3542-6385-4738-bf62-8fcad56e3cbc'; -- Sistema de venta — Florida

update public.obligaciones set fecha_limite='2026-08-17', updated_at=now()
  where id='b6cdae76-da4d-4630-9eed-ffc334171084'; -- Honorarios contadora — Florida

update public.obligaciones set fecha_limite='2026-08-11', updated_at=now()
  where id='447c9141-9f9b-411b-8347-3c11ec6048c0'; -- IMSS-Infonavit — Florida

update public.obligaciones set fecha_limite='2026-08-17', updated_at=now()
  where id='8a052e50-7761-478f-8b5e-915e214da3a8'; -- Erogaciones — Florida

update public.obligaciones set fecha_limite='2027-06-26', updated_at=now()
  where id='0d46614b-b6ee-436a-9615-d83e4689188d'; -- Refrendo — Florida

update public.obligaciones set fecha_limite='2026-08-09', updated_at=now()
  where id='67703e3e-a104-4ce4-a27c-7803739c691a'; -- Alarmas — Florida

update public.obligaciones set fecha_limite='2026-08-27', updated_at=now()
  where id='aa45cb26-67f4-4f2b-8e8a-0a52887ac74b'; -- Fumigación — Florida (fecha placeholder, cambio de proveedor)

update public.obligaciones set activa=false, updated_at=now()
  where id='65c6845e-e55f-430c-80b0-f8962ff483fb'; -- Sueldos e IVA — Florida (se descarta, solo queda ISR/IVA)

update public.obligaciones set fecha_limite='2026-08-14', updated_at=now()
  where id='eb21a19e-3400-4810-86d5-c4ea6053e94e'; -- Impuesto ISR/IVA — Florida (al corriente)

update public.obligaciones set activa=false, updated_at=now()
  where id='f741de54-48db-4282-a5e6-7dd62f06710f'; -- Limpia pública (Florida, suelta) — va incluida en Pago a locatarios

update public.obligaciones set activa=false, updated_at=now()
  where id='714a729e-5454-4cdf-92fe-2f13fc1a6f10'; -- H. Ayuntamiento — Florida — duplicado de Pago a locatarios

update public.obligaciones set activa=false, updated_at=now()
  where id='76fce554-dd19-4d62-aa97-6b1f14f0f6d4'; -- Seguro de establecimientos — Florida (aún no contratado)

-- Impuestos Hotel/Puebla (mismo RFC, se combinan en un solo registro compartido)
update public.obligaciones set nombre='Impuesto ISR/IVA — Hotel/Puebla', entidad='MULTI', updated_at=now()
  where id='7dfd6e4c-5ab2-45fb-abc7-160179df5df0'; -- antes "Impuesto ISR/IVA — Puebla"

update public.obligaciones set activa=false, updated_at=now()
  where id='b887b210-f484-4b8c-b1b0-386f93659753'; -- SAT (...) — Puebla, duplicado del anterior
