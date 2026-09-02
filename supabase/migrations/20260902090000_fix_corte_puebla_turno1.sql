-- Correccion manual, puntual, del corte de Puebla turno #1 (1-sep-2026) --
-- decision explicita del dueno, 2026-09-02, tras comparar contra el corte
-- fisico en papel de ese dia (diferencia real: $5.94). Esto rompe a
-- proposito la regla de "cortes_caja solo lo escribe el POS" (ver
-- 20260804230000_cortes_caja.sql) para ESTA fila puntual, porque el corte ya
-- se habia mandado con datos incompletos y Pescador POS no reenvia solo un
-- turno ya cerrado. No usar este patron para corregir cortes futuros --
-- para eso esta correcciones_anterior_pendientes (arreglа el ARRASTRE hacia
-- adelante) mas la captura correcta en el POS (bodega con el tipo correcto,
-- ADO capturado como vale).
--
-- Que estaba mal:
--   1) El movimiento de bodega ("VENTA" $9,000) se capturo como tipo
--      'deposito' cuando debia ser 'retiro' -- eso hacia que saldo_bodega
--      saliera en -9000 en vez de +9000 (ver _saldo_categoria_turno en
--      pescador-pos/src/operaciones/caja.py: retiro - deposito).
--   2) El ADO del dia (Jalapa $380.35 + Norte $21,527.81 + Veracruz
--      $1,064.98 = $22,973.14) nunca se capturo -- por ahora Puebla no
--      separa ADO como su propio metodo de pago, asi que entra como vale
--      normal (instruccion explicita del dueno).
--   3) El "anterior" (caja $43,086.59 / vales $16,826.54) nunca se habia
--      sembrado -- Puebla llevaba desde el turno #2 (15-ago) arrastrando
--      $0 en vez del saldo real.

-- 1) Arregla el signo del movimiento de bodega y agrega el ADO del dia como
--    vales nuevos en el desglose.
update public.cortes_caja
set datos = jsonb_set(
  datos,
  '{movimientos_desglose}',
  (
    select jsonb_agg(
      case when elem->>'categoria' = 'bodega' and elem->>'concepto' = 'VENTA'
        then jsonb_set(elem, '{tipo}', '"retiro"')
        else elem
      end
    )
    from jsonb_array_elements(datos->'movimientos_desglose') as elem
  ) || '[
    {"tipo":"retiro","fecha":"2026-09-01T20:59:32","medio":"caja","monto":152.14,"concepto":"ADO JALAPA","categoria":"vales","usuario_nombre":"Alejandra"},
    {"tipo":"retiro","fecha":"2026-09-01T20:59:32","medio":"caja","monto":228.21,"concepto":"ADO JALAPA","categoria":"vales","usuario_nombre":"Alejandra"},
    {"tipo":"retiro","fecha":"2026-09-01T20:59:32","medio":"caja","monto":18941.43,"concepto":"ADO NORTE","categoria":"vales","usuario_nombre":"Alejandra"},
    {"tipo":"retiro","fecha":"2026-09-01T20:59:32","medio":"caja","monto":2586.38,"concepto":"ADO NORTE","categoria":"vales","usuario_nombre":"Alejandra"},
    {"tipo":"retiro","fecha":"2026-09-01T20:59:32","medio":"caja","monto":1064.98,"concepto":"ADO VERACRUZ","categoria":"vales","usuario_nombre":"Alejandra"}
  ]'::jsonb
)
where sucursal = 'Av. Puebla' and turno_id = 1;

-- 2) Recalcula los saldos agregados y el cuadre del dia con el arrastre real.
update public.cortes_caja
set
  diferencia_cuadre = 5.94,
  datos = jsonb_set(
    jsonb_set(datos, '{saldo_bodega}', '9000'::jsonb),
    '{saldo_vales}', '41093.68'::jsonb
  ) || jsonb_build_object('cuadre', jsonb_build_object(
    'tira', 30120,
    'esperado', 73206.59,
    'anterior_caja', 43086.59,
    'anterior_vales', 16826.54,
    'gastos_totales', 8660.35,
    'anterior_bodega', 0,
    'anterior_baucher', 0,
    'diferencia_cuadre', 5.94,
    'primer_total_caja', 64552.18,
    'segundo_total_caja', 73212.53
  ))
where sucursal = 'Av. Puebla' and turno_id = 1;
