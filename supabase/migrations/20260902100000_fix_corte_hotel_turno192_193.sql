-- Correccion manual, puntual, de los cortes de Hotel turno #192 y #193
-- (1-sep-2026, 8am-8pm y 8pm-8am) -- decision explicita del dueno,
-- 2026-09-02, tras comparar contra el corte fisico en papel de ese dia
-- (un solo corte de papel se arma con estos DOS cortes digitales juntos;
-- diferencia real combinada: $0.00).
--
-- Que estaba mal:
--   1) El turno 192 nacio con anterior_baucher=$7,400 -- un residuo de
--      cuando se activo el corte de recepcion del hotel ese mismo dia, no
--      el saldo real de Baucher antes de septiembre (el papel dice que TODO
--      el arrastre antes de este dia era de $1,800, y estaba en Vales del
--      Personal -- nada en Baucher ni Bodega). Eso inflaba Baucher y todo
--      lo que dependia de el.
--   2) El turno 193 no arrastro el saldo de Bodega/Baucher que dejo el 192
--      al cerrar (le quedo anterior_bodega=$0 y anterior_baucher=$0 en vez
--      de $5,500 / $7,400) -- bug de encadenado entre los 2 turnos del
--      mismo dia (ver anteriores_para_turno_nuevo() en
--      hotel-sistema/src/caja/corte_recepcion.py).
--   3) El movimiento de Bodega del 193 (Mario) se capturo como el TOTAL
--      nuevo ($6,000) en vez del movimiento real de su turno ($500) --
--      encima del anterior ya arrastrado de $5,500 hace $6,000, que es lo
--      que de casualidad ya tenia, pero mal desglosado.
--   4) Monedas ($36) y billetes ($400) del conteo fisico de fin de dia
--      nunca se capturaron en el 193 (quedaron en $0).
--   5) El gasto "Pan $64" del turno 192 nunca se refleja en el checksum del
--      193 porque el software solo suma los gastos de CADA turno a su
--      propio checksum, no los arrastra -- por eso, aun con todo lo demas
--      corregido, el 192 queda en -$236 y el 193 en +$236 (se cancelan
--      exactamente; el dia combinado cuadra en $0, igual que el papel).
--      Es un hueco de diseno para cortes que se parten en 2 (ver commit
--      aparte que ajusta hotel-sistema/src/oficina/sync_corte.py para que
--      esto no se repita en dias futuros).

-- Turno 192 (Alexa, 8am-8pm)
update public.cortes_caja
set
  diferencia_cuadre = -236,
  datos = jsonb_set(
    datos,
    '{resumen_recepcion}',
    (datos->'resumen_recepcion')
      || jsonb_build_object(
        'anterior_baucher', 0,
        'anterior', 1800,
        'total_caja_1', 14700,
        'total_caja_2', 14764,
        'total_check', 15000,
        'diferencia', -236,
        'totales_cuentas', (datos->'resumen_recepcion'->'totales_cuentas') || jsonb_build_object('baucher', 7400)
      )
  ) || jsonb_build_object('cuadre', jsonb_build_object('diferencia_cuadre', -236))
where sucursal ilike '%hotel%' and turno_id = 192;

-- Turno 193 (Mario, 8pm-8am) -- cierra el corte fisico combinado del 1-sep
update public.cortes_caja
set
  diferencia_cuadre = 236,
  datos = jsonb_set(
    datos,
    '{resumen_recepcion}',
    (
      (datos->'resumen_recepcion')
      || jsonb_build_object(
        'anterior_bodega', 5500,
        'anterior_baucher', 7400,
        'monedas', 36,
        'billetes', 400,
        'total_caja_1', 18436,
        'total_caja_2', 18436,
        'anterior', 14700,
        'total_check', 18200,
        'diferencia', 236,
        'totales_cuentas', (datos->'resumen_recepcion'->'totales_cuentas') || jsonb_build_object('bodega', 6000, 'baucher', 10200)
      )
    ) || jsonb_build_object(
      'movimientos_cuentas',
      (
        select jsonb_agg(
          case when elem->>'cuenta' = 'bodega' and elem->>'concepto' = 'BODEGA'
            then jsonb_set(elem, '{monto}', '500'::jsonb)
            else elem
          end
        )
        from jsonb_array_elements(datos->'resumen_recepcion'->'movimientos_cuentas') as elem
      )
    )
  ) || jsonb_build_object('cuadre', jsonb_build_object('diferencia_cuadre', 236))
where sucursal ilike '%hotel%' and turno_id = 193;
