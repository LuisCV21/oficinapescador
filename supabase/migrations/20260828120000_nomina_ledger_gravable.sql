-- Segundo dato por semana en la Bitacora Nomina del Balance, ademas del
-- monto en efectivo que ya se capturaba: el total gravable (percepciones
-- sujetas a ISR/IMSS) que la oficina necesita para pasarle a la contadora,
-- igual que el "Total gravable" que daba el reporte de nomina de Aspel NOI.
alter table public.nomina_ledger add column if not exists gravable numeric(10,2);
