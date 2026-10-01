"""
Compara las facturas que EXISTEN en Factura.com (por empresa: HOT, FLO, PUE) contra
las que Oficina conoce (cortes, facturas individuales, cancelaciones, autofacturas).
Lo que salga en la lista existe en Factura.com y Oficina no lo sabe: la Global lo
volveria a facturar (duplicado) si es de un cliente, o es la Global del mes anterior.
Solo lectura. Las llaves de Factura.com se leen de Oficina y viven solo en memoria.
Uso: python tools/verificar_facturas_factura_com.py   (cambia MES/ANIO abajo)
"""
import json, subprocess, urllib.request, urllib.error, re, sys, collections

from pathlib import Path
CWD = str(Path(__file__).parent.parent)
MES, ANIO = 9, 2026
HOST = "https://api.factura.com"
PLUGIN = re.search(r'const F_PLUGIN\s*=\s*"([^"]+)"', open(CWD + "/supabase/functions/oficina-facturacion-global/index.ts", encoding="utf-8").read()).group(1)


def q(sql):
    r = subprocess.run(["npx", "supabase", "db", "query", "--linked", sql], cwd=CWD, capture_output=True, text=True, shell=True, encoding="utf-8")
    t = r.stdout
    return json.loads(t[t.index("{"):])["rows"]


cortes = q("select sucursal, datos from cortes_caja where apertura >= '2026-08-30'")
indiv = q("select entidad, uuid_fiscal, folio, total, estado from facturas_individuales")
canc = q("select uuid_fiscal, folio_sustituto, sucursal from cfdi_cancelaciones")
SUC = {"HOT": "Real de Poza Hotel", "FLO": "Florida", "PUE": "Av. Puebla"}

for ent in ("HOT", "FLO", "PUE"):
    cred = q(f"select api_key, secret_key from facturacom_credenciales where entidad='{ent}'")
    if not cred:
        print(ent, "sin credenciales"); continue
    hdr = {"Content-Type": "application/json", "F-PLUGIN": PLUGIN, "F-Api-Key": cred[0]["api_key"], "F-Secret-Key": cred[0]["secret_key"]}
    todas, pag = [], 1
    while True:
        req = urllib.request.Request(f"{HOST}/v4/cfdi40/list?month={MES}&year={ANIO}&per_page=100&page={pag}", headers=hdr)
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.loads(r.read().decode("utf-8"))
        todas += d["data"]
        if pag >= d["last_page"]:
            break
        pag += 1
    # UUIDs que Oficina conoce
    conocidos = set()
    for c in cortes:
        if c["sucursal"] != SUC[ent]:
            continue
        dd = c["datos"] or {}
        for f in dd.get("facturas_detalle") or []:
            if f.get("uuid_fiscal"): conocidos.add(f["uuid_fiscal"].lower())
        for p in dd.get("pagos_detalle") or []:
            if p.get("uuid_fiscal"): conocidos.add(p["uuid_fiscal"].lower())
            a = p.get("autofactura") or {}
            if a.get("uuid_fiscal"): conocidos.add(a["uuid_fiscal"].lower())
        for cu in dd.get("cuentas") or []:
            a = cu.get("autofactura") or {}
            if a.get("uuid_fiscal"): conocidos.add(a["uuid_fiscal"].lower())
            s = (a.get("sustituye") or {}).get("uuid_fiscal")
            if s: conocidos.add(s.lower())
    for i in indiv:
        if i["entidad"] == ent and i["uuid_fiscal"]: conocidos.add(i["uuid_fiscal"].lower())
    for c in canc:
        if c.get("uuid_fiscal"): conocidos.add(c["uuid_fiscal"].lower())
        if c.get("folio_sustituto"): conocidos.add(c["folio_sustituto"].lower())
    vivas = [x for x in todas if x.get("Status") not in ("eliminada",)]
    desc = [x for x in vivas if str(x.get("UUID", "")).lower() not in conocidos]
    glob_like = [x for x in desc if "PUBLICO EN GENERAL" in str(x.get("RazonSocialReceptor", "")).upper()]
    print(f"\n===== {ent}: CFDI en Factura.com (sept) {len(todas)} | vigentes/canceladas {len(vivas)} | que Oficina NO conoce: {len(desc)} (de ellos a PUBLICO EN GENERAL: {len(glob_like)})")
    for x in sorted(desc, key=lambda z: str(z.get("FechaTimbrado"))):
        print(f"   {str(x.get('FechaTimbrado'))[:10]} Folio {x.get('Folio'):<8} ${float(x.get('Total')):>9,.2f}  {str(x.get('Status')):<9} {str(x.get('RazonSocialReceptor'))[:40]}  {str(x.get('UUID'))[:8]}")
