"""
Registra en Oficina (facturas_individuales) dos facturas del HOTEL que ya estan
timbradas en Factura.com pero que el corte nunca supo (el hotel las dejo como
'pendiente' o se hicieron despues de enviar el turno):

    folio 405  -> ROYAL TRANSPORTS            $700   (efectivo,       A-264, 1-sep)
    folio 624  -> KB TEL TELECOMUNICACIONES   $2,100 (tarjeta debito, A-442, 10-sep)

Con eso la Global ya no ofrece esos folios (duplicaria la factura) y la Poliza
Banco los cuenta como facturados a cliente. Los datos fiscales salen del XML real
de cada CFDI en Factura.com (solo lectura). Las llaves se leen de Oficina y solo
viven en memoria.

Uso:
    python tools/cubrir_facturas_hotel_septiembre.py            # vista previa, no escribe
    python tools/cubrir_facturas_hotel_septiembre.py --aplicar  # escribe tras escribir CUBRIR
"""
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).parent.parent
HOST = "https://api.factura.com"
PLUGIN = re.search(r'const F_PLUGIN\s*=\s*"([^"]+)"',
                   (RAIZ / "supabase/functions/oficina-facturacion-global/index.ts").read_text(encoding="utf-8")).group(1)

# folio de venta del hotel -> (UUID del CFDI en Factura.com a buscar por folio fiscal)
CASOS = [
    {"folio": 405, "folio_fiscal": "A 264", "forma_sat": "01"},
    {"folio": 624, "folio_fiscal": "A 442", "forma_sat": "28"},
]


def consulta(sql):
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


def attr(xml, tag, name):
    m = re.search(rf'<{tag}\b[^>]*?\s{name}="([^"]*)"', xml)
    if not m:
        return None
    return (m.group(1).replace("&amp;", "&").replace("&quot;", '"').replace("&apos;", "'")
            .replace("&lt;", "<").replace("&gt;", ">"))


def main():
    aplicar = "--aplicar" in sys.argv
    if (RAIZ / "supabase/.temp/project-ref").read_text().strip() != "vbcmobckogmljqkkrqxp":
        sys.exit("Proyecto enlazado inesperado; abortando.")
    cred = consulta("select api_key, secret_key from facturacom_credenciales where entidad='HOT'")[0]
    hdr = {"Content-Type": "application/json", "F-PLUGIN": PLUGIN, "F-Api-Key": cred["api_key"], "F-Secret-Key": cred["secret_key"]}

    def get(path):
        with urllib.request.urlopen(urllib.request.Request(HOST + path, headers=hdr), timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))

    # CFDI del mes por folio fiscal
    todas, pag = [], 1
    while True:
        d = get(f"/v4/cfdi40/list?month=9&year=2026&per_page=100&page={pag}")
        todas += d["data"]
        if pag >= d["last_page"]:
            break
        pag += 1
    por_folio = {x["Folio"]: x for x in todas}

    filas = []
    for caso in CASOS:
        x = por_folio.get(caso["folio_fiscal"])
        if not x or x.get("Status") != "enviada":
            sys.exit(f"No se encontro el CFDI {caso['folio_fiscal']} vigente en Factura.com.")
        xml = str((get(f"/v4/cfdi/uuid/{x['UUID']}").get("data") or {}).get("XML") or "")
        existe = consulta(f"select 1 from facturas_individuales where entidad='HOT' and folio={caso['folio']} "
                          f"and left(fecha_venta,7)='2026-09' limit 1")
        # pago del corte (cuenta y fecha reales de la venta)
        pago = None
        for c in consulta("select datos->'pagos_detalle' pd from cortes_caja where sucursal='Real de Poza Hotel' "
                          "and apertura >= '2026-08-31' and apertura < '2026-09-12'"):
            for p in c["pd"] or []:
                if p.get("folio") == caso["folio"]:
                    pago = p
        if not pago:
            sys.exit(f"No se encontro el folio {caso['folio']} en los cortes.")
        fila = {
            "entidad": "HOT", "folio": caso["folio"], "cuenta": pago.get("cuenta"), "fecha_venta": pago["fecha"],
            "subtotal": float(attr(xml, "cfdi:Comprobante", "SubTotal") or 0),
            "iva": round(float(attr(xml, "cfdi:Comprobante", "Total") or 0) - float(attr(xml, "cfdi:Comprobante", "SubTotal") or 0), 2),
            "total": float(attr(xml, "cfdi:Comprobante", "Total") or 0),
            "forma_pago": attr(xml, "cfdi:Comprobante", "FormaPago") or caso["forma_sat"],
            "metodo_pago": attr(xml, "cfdi:Comprobante", "MetodoPago") or "PUE",
            "rfc_receptor": attr(xml, "cfdi:Receptor", "Rfc"), "razon_social": attr(xml, "cfdi:Receptor", "Nombre"),
            "regimen_fiscal": attr(xml, "cfdi:Receptor", "RegimenFiscalReceptor"), "uso_cfdi": attr(xml, "cfdi:Receptor", "UsoCFDI"),
            "cp_receptor": attr(xml, "cfdi:Receptor", "DomicilioFiscalReceptor"),
            "estado": "timbrada", "facturapi_id": x.get("UID"), "uuid_fiscal": x["UUID"], "folio_pac": caso["folio_fiscal"].split()[-1],
            "_ya_existe": bool(existe), "_monto_corte": pago.get("monto"), "_forma_corte": pago.get("forma_pago"),
        }
        # verificaciones de coherencia
        assert abs(fila["total"] - float(pago["monto"])) < 0.01, f"El total del CFDI no coincide con el folio {caso['folio']}"
        filas.append(fila)

    print("VISTA PREVIA\n")
    for f in filas:
        print(f"Folio {f['folio']} <- CFDI {f['folio_pac']}  UUID {f['uuid_fiscal'][:8]}...  ${f['total']:,.2f}  forma SAT {f['forma_pago']} (venta: {f['_forma_corte']})"
              f"\n   {f['razon_social']} ({f['rfc_receptor']})  regimen {f['regimen_fiscal']}  uso {f['uso_cfdi']}  CP {f['cp_receptor']}"
              f"\n   venta {f['fecha_venta']}  cuenta {f['cuenta']}  | ya registrada en Oficina: {f['_ya_existe']}\n")
    if not aplicar:
        print("Para escribir: --aplicar")
        return
    if any(f["_ya_existe"] for f in filas):
        sys.exit("Alguno ya esta registrado; no se escribe nada.")
    if input("Escribe CUBRIR para registrar estas facturas en Oficina: ").strip() != "CUBRIR":
        sys.exit("Cancelado. No se escribio nada.")
    cols = ["entidad", "folio", "cuenta", "fecha_venta", "subtotal", "iva", "total", "forma_pago", "metodo_pago", "rfc_receptor",
            "razon_social", "regimen_fiscal", "uso_cfdi", "cp_receptor", "estado", "facturapi_id", "uuid_fiscal", "folio_pac"]
    for f in filas:
        vals = ", ".join("null" if f[c] is None else (str(f[c]) if isinstance(f[c], (int, float)) else "$v$" + str(f[c]).replace("$v$", "") + "$v$") for c in cols)
        consulta(f"insert into facturas_individuales ({', '.join(cols)}) values ({vals}); select 1 as ok")
        print(f"  folio {f['folio']} registrado")


if __name__ == "__main__":
    main()
