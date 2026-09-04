-- Correccion manual, puntual, de los cortes de Hotel turno #195 (noche
-- 2->3-sep) y #196 (dia 3-sep) -- decision explicita del dueno, 2026-09-04,
-- tras comparar contra los cortes fisicos en papel del 2-sep y 3-sep.
--
-- Causa raiz encontrada en el codigo (hotel-sistema/src/caja/corte_recepcion.py
-- y src/oficina/sync_corte.py): el turno #195 abrio con anterior_bodega=$6,000
-- y anterior_baucher=$18,050 en vez de heredar lo que de verdad dejo el
-- turno #194 al cerrar (bodega $10,000, baucher $19,450) -- exactamente los
-- dos ultimos movimientos manuales que Esmeralda capturo justo al cerrar el
-- #194 (bodega "ESMERALDA" $4,000 y baucher "VOUCHER'S NOTA" $1,400) nunca
-- se reflejaron en lo que el #195 heredo. Ademas el campo "anterior" del
-- checksum del #195 quedo en $46,859.68 (no corresponde a nada real) en vez
-- de heredar el "anterior" del #194 ($18,436, mismo dia calendario => se
-- combinan segun sync_corte.calcular_corte), y "ventas"/"gastos" nunca
-- sumaron lo del #194 tampoco.
--
-- Por separado: el papel fisico del 2-sep solo documenta hasta el cierre
-- del #194 (nadie conto Bodega/Baucher/Monedas/Billetes aparte para el
-- turno de noche #195), y el papel del 3-sep arranca su arrastre de Bodega/
-- Baucher desde ESA MISMA base del #194 ($10,000/$19,450), sin incluir los
-- $4,000/$1,400 que el #195 capturo esa noche -- o sea, fisicamente esos
-- movimientos del #195 nunca se conciliaron con nada, quedan como pendiente
-- aparte (no se tocan aqui: se dejan igual en movimientos_cuentas para no
-- perder el rastro, pero no se suman al arrastre porque el papel no los
-- reconoce). Por eso el #195 se corrige solo en su checksum (anterior/
-- ventas/gastos), no en sus totales de cuenta -- y queda con una diferencia
-- real de -$1,792 que no se puede achicar mas sin papel de esa noche
-- especifica; hay que preguntarle a Williams.
--
-- El turno #196 si tiene papel fisico completo y sus totales de cuenta
-- (Bodega $12,500, Baucher $35,750, Vales Sr.Antonio $3,679.68, Vales
-- Personal $2,330, Monedas $28, Billetes $20) nunca se capturaron en el
-- POS -- Alexa/Mario nunca metieron $1,500/$1,000 de Bodega, ni un
-- movimiento de Baucher de $4,900, ni el conteo fisico de Monedas/
-- Billetes. Confirmado con el dueno contra el papel (2026-09-04).

-- Turno 195 (Williams, noche 2-sep 20:27 a 3-sep 08:15)
update public.cortes_caja
set
  diferencia_cuadre = -1792,
  datos = jsonb_set(
    datos,
    '{resumen_recepcion}',
    (datos->'resumen_recepcion')
      || jsonb_build_object(
        'anterior_bodega', 10000,
        'anterior_baucher', 19450,
        'anterior', 18436,
        'ventas', 17900,
        'gastos', 64,
        'total_caja_2', 34544,
        'total_check', 36336,
        'diferencia', -1792
      )
  ) || jsonb_build_object('cuadre', jsonb_build_object('diferencia_cuadre', -1792))
where sucursal ilike '%hotel%' and turno_id = 195;

-- Turno 196 (Alexa, dia 3-sep 08:35 a 20:02)
update public.cortes_caja
set
  diferencia_cuadre = 5991.68,
  datos = jsonb_set(
    datos,
    '{resumen_recepcion}',
    (
      (datos->'resumen_recepcion')
      || jsonb_build_object(
        'monedas', 28,
        'billetes', 20,
        'total_caja_1', 54307.68,
        'total_caja_2', 54371.68,
        'diferencia', 5991.68,
        'totales_cuentas', (datos->'resumen_recepcion'->'totales_cuentas') || jsonb_build_object('bodega', 12500, 'baucher', 35750)
      )
    )
  ) || jsonb_build_object('cuadre', jsonb_build_object('diferencia_cuadre', 5991.68))
where sucursal ilike '%hotel%' and turno_id = 196;
