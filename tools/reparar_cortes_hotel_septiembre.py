"""
Repara en Oficina tres cortes del hotel (turnos 240, 241 y 246) cuyos totales por
forma de pago quedaron desfasados de sus folios:

  240 (25-sep, dia):   folio 959 ($600, tarjeta de debito) quedo con forma 'debito'
                       y en CERO en los totales -> falta $600 en tarjeta de debito.
  241 (25-sep, noche): pagos y totales con 'credito' (nombre de restaurante) en vez
                       de 'tarjeta_credito'; la columna de diferencia tenia un valor viejo.
  246 (28-sep, dia):   transferencias $2,472 en el total contra $1,900 en los folios
                       (un duplicado de $572 que ya se habia quitado de los folios).

Usa la MISMA formula que el editor de cortes de Oficina (recalcularCorteHotelJson,
leida directo de index.html): vuelve a derivar ventas_por_forma y total_ventas de
los folios y deja el checksum "Ventas" del turno igual al total donde corresponde.
Los turnos de noche (241, 247) ya acumulaban el total correcto del dia.

Uso:
    python tools/reparar_cortes_hotel_septiembre.py            # vista previa, no escribe
    python tools/reparar_cortes_hotel_septiembre.py --aplicar  # respalda a Desktop y escribe

Solo toca esos tres renglones de cortes_caja (datos y diferencia_cuadre) y agrega
una entrada en datos.ediciones. Respalda el JSON original antes.
"""
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).parent.parent
SUCURSAL = "Real de Poza Hotel"
TURNOS = (240, 241, 246)
AJUSTAR_VENTAS = {240, 246}   # el checksum de ventas del turno = total recalculado


def consulta(sql: str):
    r = subprocess.run(["npx", "supabase", "db", "query", "--linked", sql], cwd=RAIZ,
                       capture_output=True, text=True, shell=True, encoding="utf-8")
    t = r.stdout
    i = t.find("{")
    if i < 0:
        raise RuntimeError(r.stderr or t)
    d = json.loads(t[i:])
    if "rows" not in d:
        raise RuntimeError(t[i:i + 500])
    return d["rows"]


def funcion_recalculo() -> str:
    s = (RAIZ / "index.html").read_text(encoding="utf-8")
    i = s.index("function recalcularCorteHotelJson(d){")
    j = s.index("\n}\n", i) + 3
    return s[i:j]


JS = r"""
const fs = require('fs');
%FN%
const entrada = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const NORM = { credito: 'tarjeta_credito', debito: 'tarjeta_debito' };
const salida = [];
for (const o of entrada) {
  const d = JSON.parse(JSON.stringify(o.datos)); const rr = d.resumen_recepcion;
  d.pagos_detalle = (d.pagos_detalle || []).map(p => ({ ...p, forma_pago: NORM[String(p.forma_pago || '').toLowerCase()] || p.forma_pago }));
  recalcularCorteHotelJson(d);
  if (o.ajustarVentas) { rr.ventas = d.total_ventas; recalcularCorteHotelJson(d); }
  d.ediciones = Array.isArray(d.ediciones) ? d.ediciones : [];
  d.ediciones.push({ fecha: new Date().toISOString(), usuario: 'Reparacion (Claude)', motivo: o.motivo,
    diferencia_cuadre_antes: Number(o.colAntes || 0), diferencia_cuadre_despues: d.cuadre.diferencia_cuadre });
  salida.push({ turno: o.turno, id: o.id, datos: d, dif: d.cuadre.diferencia_cuadre });
}
fs.writeFileSync(process.argv[3], JSON.stringify(salida));
"""

MOTIVOS = {
    240: "Folio 959 ($600) corregido a tarjeta de debito: se restauran los totales por forma de pago (faltaban $600 en debito).",
    241: "Formas de pago 'credito' normalizadas a tarjeta_credito (nombre del hotel); diferencia de la columna alineada con el corte.",
    246: "Se recalculan los totales por forma de pago desde los folios (transferencia $1,900; el duplicado de $572 ya estaba fuera de los folios).",
}


def main():
    aplicar = "--aplicar" in sys.argv
    ref = (RAIZ / "supabase" / ".temp" / "project-ref").read_text().strip()
    if ref != "vbcmobckogmljqkkrqxp":
        sys.exit(f"Proyecto enlazado inesperado ({ref}); abortando.")
    filas = consulta(f"select id, turno_id, datos, diferencia_cuadre from cortes_caja where sucursal='{SUCURSAL}' "
                     f"and turno_id in ({','.join(map(str, TURNOS))}) order by turno_id")
    if len(filas) != len(TURNOS):
        sys.exit(f"Se esperaban {len(TURNOS)} cortes y hay {len(filas)}.")
    tmp = Path(sys.argv[0]).parent / "_tmp_reparar"
    tmp.mkdir(exist_ok=True)
    (tmp / "entrada.json").write_text(json.dumps([
        {"id": f["id"], "turno": f["turno_id"], "datos": f["datos"], "ajustarVentas": f["turno_id"] in AJUSTAR_VENTAS,
         "motivo": MOTIVOS[f["turno_id"]], "colAntes": f["diferencia_cuadre"]} for f in filas]), encoding="utf-8")
    (tmp / "calc.js").write_text(JS.replace("%FN%", funcion_recalculo()), encoding="utf-8")
    r = subprocess.run(["node", str(tmp / "calc.js"), str(tmp / "entrada.json"), str(tmp / "salida.json")],
                       capture_output=True, text=True)
    if r.returncode:
        sys.exit("Error calculando: " + r.stderr)
    nuevos = {x["turno"]: x for x in json.loads((tmp / "salida.json").read_text(encoding="utf-8"))}

    print("VISTA PREVIA (nada se escribe sin --aplicar)\n")
    for f in filas:
        t = f["turno_id"]; a = f["datos"]; n = nuevos[t]["datos"]
        print(f"Turno {t}")
        print(f"  ventas_por_forma antes:   {json.dumps(a.get('ventas_por_forma'))}")
        print(f"  ventas_por_forma despues: {json.dumps(n.get('ventas_por_forma'))}")
        print(f"  total_ventas {a.get('total_ventas')} -> {n.get('total_ventas')} | checksum ventas "
              f"{a['resumen_recepcion'].get('ventas')} -> {n['resumen_recepcion'].get('ventas')}")
        print(f"  diferencia (corte) {a['resumen_recepcion'].get('diferencia')} -> {nuevos[t]['dif']} | columna {f['diferencia_cuadre']} -> {nuevos[t]['dif']}\n")
    if not aplicar:
        print("Para escribir: --aplicar")
        return

    dest = Path.home() / "Desktop" / f"Respaldo_cortes_hotel_{datetime.now():%Y%m%d_%H%M%S}.json"
    dest.write_text(json.dumps(filas, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(f"Respaldo de los 3 cortes originales: {dest}")
    if input("Escribe APLICAR para actualizar esos 3 cortes en Oficina: ").strip() != "APLICAR":
        sys.exit("Cancelado. No se escribio nada.")
    for t, x in nuevos.items():
        cuerpo = json.dumps(x["datos"], ensure_ascii=False).replace("$json$", "")
        consulta(f"update cortes_caja set datos = $json${cuerpo}$json$::jsonb, diferencia_cuadre = {x['dif']}, "
                 f"total_ventas = {x['datos']['total_ventas']} where id = '{x['id']}' and sucursal='{SUCURSAL}'; select 1 as ok")
        print(f"  turno {t} actualizado")
    print("Listo.")


if __name__ == "__main__":
    main()
