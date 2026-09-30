"""
Archivo y limpieza de fin de mes -- Oficina Pescador (Supabase).

Uso (desde la carpeta oficinapescador, con `npx supabase login` ya hecho):
    python tools/archivar_mes_oficina.py            # solo RESPALDA y cuenta, no borra nada
    python tools/archivar_mes_oficina.py --borrar   # respalda y, tras escribir BORRAR, limpia

Respalda a JSON (Desktop/Respaldo_Oficina_<fecha>/) las tablas que dependen de
folios o de turnos y, con --borrar, las vacia para que el mes nuevo arranque
limpio (folios y turnos reiniciados en los POS ya no chocan con los del mes
anterior: cortes_caja es unique(sucursal, turno_id) y facturas_individuales es
unique(entidad, folio)).

NO toca: facturas_globales (historial fiscal), nomina, empleados, balances,
ado_ledger, clientes_fiscales ni nada que no dependa de folio/turno.

Hacerlo SOLO despues de timbrar las globales del mes y de que los POS ya hayan
aplicado las cancelaciones/correcciones pendientes.
"""
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

TABLAS = [
    "cortes_caja", "facturas_individuales", "cfdi_cancelaciones",
    "acciones_venta_pendientes", "acciones_pos_directas",
    "correcciones_pago_pendientes", "correcciones_anterior_pendientes",
    "gastos_clasificacion_overrides",
]
RAIZ = Path(__file__).parent.parent
DESKTOP = Path.home() / "Desktop"


def consulta(sql: str):
    r = subprocess.run(
        ["npx", "supabase", "db", "query", "--linked", sql],
        cwd=RAIZ, capture_output=True, text=True, shell=True, encoding="utf-8",
    )
    out = r.stdout
    i = out.find("{")
    if i < 0:
        raise RuntimeError(f"Consulta fallo: {r.stderr or out}")
    d = json.loads(out[i:])
    if "rows" not in d:
        raise RuntimeError(f"Consulta fallo: {out[i:i+500]}")
    return d["rows"]


def main():
    borrar = "--borrar" in sys.argv
    ref = (RAIZ / "supabase" / ".temp" / "project-ref").read_text().strip()
    if ref != "vbcmobckogmljqkkrqxp":
        sys.exit(f"Proyecto enlazado inesperado ({ref}); abortando.")

    conteos = {t: consulta(f"select count(*) c from {t}")[0]["c"] for t in TABLAS}
    print("Filas por tabla:")
    for t, c in conteos.items():
        print(f"  {t:<34} {c:>7}")

    pend = consulta("select count(*) c from acciones_venta_pendientes where estado='pendiente'")[0]["c"]
    pend2 = consulta("select count(*) c from correcciones_pago_pendientes where aplicada_at is null")[0]["c"] \
        if False else None
    if pend:
        print(f"\n!! Hay {pend} accion(es) de venta PENDIENTES de aplicar en algun POS.")
        print("   Esperar a que los POS las apliquen (abrir turno) antes de borrar.")

    dest = DESKTOP / f"Respaldo_Oficina_{datetime.now():%Y-%m-%d_%H%M%S}"
    dest.mkdir(parents=True, exist_ok=True)
    for t in TABLAS:
        rows = consulta(f"select * from {t}")
        (dest / f"{t}.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
        print(f"  respaldado {t}: {len(rows)} filas")
    print(f"\nRespaldo completo en: {dest}")

    if not borrar:
        print("\n(Solo respaldo. Usa --borrar para limpiar.)")
        return
    if pend:
        if input("Hay acciones pendientes; escribe FORZAR para borrar de todos modos: ").strip() != "FORZAR":
            sys.exit("Cancelado. No se borro nada.")
    if input("\nEscribe BORRAR (mayusculas) para vaciar esas tablas en Oficina: ").strip() != "BORRAR":
        sys.exit("Cancelado. No se borro nada.")
    sql = "; ".join(f"delete from {t}" for t in TABLAS)
    consulta(sql + "; select 1 as ok")
    print("\nDespues de borrar:")
    for t in TABLAS:
        print(f"  {t:<34} {consulta(f'select count(*) c from {t}')[0]['c']:>7}")


if __name__ == "__main__":
    main()
