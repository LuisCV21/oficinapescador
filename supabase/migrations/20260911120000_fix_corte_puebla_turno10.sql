-- Correccion manual, puntual, del corte de Puebla turno #10 (10-sep-2026) --
-- decision explicita del dueno, 2026-09-11, tras comparar contra el corte
-- fisico en papel de ese dia. Rompe a proposito la regla de "cortes_caja
-- solo lo escribe el POS" para ESTA fila puntual, igual que
-- 20260902090000_fix_corte_puebla_turno1.sql -- no usar este patron para
-- corregir cortes futuros, para eso esta correcciones_anterior_pendientes
-- mas la captura correcta en el POS.
--
-- Que estaba mal:
--   La cajera saco de Baucher $21,798.04 con un solo movimiento
--   ("CORONA PAGO DE MARISCOSN110", categoria gasto_mercancia). Ese dinero
--   es lo que Madahi le transfirio a Jannet (proveedora de mariscos): de
--   ahi, $21,192.00 sí era pago real de la deuda de mercancia (Mariscos
--   N110), pero los $606.04 restantes los agrego Madahi a vales -- en el
--   corte fisico en papel eso se ve reflejado a mano metiendo esos $606.04
--   dentro de la linea "PROCESADORA" de vales (que en el sistema quedo en
--   $6,369.96 en vez de los $6,976.00 que muestra el papel). El sistema
--   nunca separo esa parte: se quedo la cantidad completa como gasto de
--   mercancia, sin mover nada a vales.
--
-- Correccion: se parte ese movimiento de Baucher en dos --
--   1) $21,192.00 en gasto_mercancia (el pago real de Mariscos N110).
--   2) $606.04 nuevo, categoria vales (el sobrante que Madahi metio a
--      vales, antes mezclado a mano en la linea "Procesadora" del papel).
-- El total de Baucher retirado no cambia ($21,798.04); solo se reclasifica
-- de gasto a vales la parte que en realidad no fue gasto.

-- 1) Parte el movimiento de Baucher en el desglose (gasto_mercancia -> 21192,
--    mas la linea nueva de vales con el sobrante).
update public.cortes_caja
set datos = jsonb_set(
  datos,
  '{movimientos_desglose}',
  (
    select jsonb_agg(
      case when elem->>'concepto' = 'CORONA PAGO DE MARISCOSN110'
           and elem->>'categoria' = 'gasto_mercancia'
        then jsonb_set(elem, '{monto}', '21192.00'::jsonb)
        else elem
      end
    )
    from jsonb_array_elements(datos->'movimientos_desglose') as elem
  ) || '[
    {"tipo":"retiro","fecha":"2026-09-10T19:12:32","medio":"baucher","monto":606.04,"concepto":"Sobrante pago Jannet (antes mezclado en Procesadora)","categoria":"vales","usuario_nombre":"Dulce"}
  ]'::jsonb
)
where sucursal = 'Av. Puebla' and turno_id = 10;

-- 2) Recalcula los agregados que dependen de esa reclasificacion: saldo_vales
--    sube 606.04 (17626.34 -> 18232.38, cuadra EXACTO con el papel) y
--    gastos_totales baja 606.04 (28679.04 -> 28073.00, cuadra EXACTO con el
--    papel). El resto del cuadre (tira, esperado, diferencia_cuadre) no
--    cambia: el dinero fisico es el mismo, solo se reclasifico.
update public.cortes_caja
set datos = jsonb_set(
  jsonb_set(datos, '{saldo_vales}', '18232.38'::jsonb),
  '{cuadre,gastos_totales}', '28073.00'::jsonb
)
where sucursal = 'Av. Puebla' and turno_id = 10;
