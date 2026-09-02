-- Correccion manual, puntual, del corte de Florida turno #1 (1-sep-2026) --
-- mismo caso que 20260902090000_fix_corte_puebla_turno1.sql: decision
-- explicita del dueno, comparado contra el corte fisico en papel de ese dia
-- (diferencia real: -$0.05). Turno #1 es el primer turno de Florida tras el
-- reinicio de contador del 1-sep (antes iba en el #48) -- el "anterior" con
-- el que arranco (caja $3,032 / bodega $33,000 / vales $20,142.32 / baucher
-- $102,792.05) es un residuo de una configuracion vieja, no el saldo real
-- que traia Florida ese dia. A diferencia de Puebla, aqui los movimientos de
-- vales del dia YA estaban bien capturados (se revisaron contra el papel:
-- -400 naranja puebla, 226 sra ana comida, 100 heriberto, 116/134/172/260
-- sra ana pollo, 800 sabina, 1000 yaneth, 200 arely, 1000 juanito, 1000
-- guadalupe, 100 belen, 50 dani = 4,758 netos) -- solo el arrastre estaba
-- mal, mas billetes que nunca se capturo ($1,950, quedo en $0).
update public.cortes_caja
set
  diferencia_cuadre = -0.05,
  datos = jsonb_set(
    jsonb_set(
      jsonb_set(datos, '{saldo_bodega}', '0'::jsonb),
      '{saldo_baucher}', '16303'::jsonb
    ),
    '{saldo_vales}', '13458.92'::jsonb
  ) || jsonb_build_object(
    'efectivo_billetes', 1950,
    'cuadre', jsonb_build_object(
      'tira', 28764,
      'esperado', 38033.42,
      'anterior_caja', 9269.42,
      'anterior_vales', 8700.92,
      'gastos_totales', 5976.95,
      'anterior_bodega', 0,
      'anterior_baucher', 0,
      'diferencia_cuadre', -0.05,
      'primer_total_caja', 32056.42,
      'segundo_total_caja', 38033.37
    )
  )
where sucursal ilike '%florida%' and turno_id = 1;
