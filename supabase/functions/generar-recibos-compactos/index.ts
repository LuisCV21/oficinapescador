// Genera, para un periodo de nomina, UN SOLO PDF combinado con la version
// compacta (1 pagina por empleado, colores de El Pescador Veracruzano) de
// cada CFDI de nomina ya timbrado -- lista para firmar e imprimir/enviar a
// las sucursales, sin pasar por ningun paso manual (antes era: descargar el
// PDF de 2 hojas de factura.com y correr un script de Python local).
//
// Los datos se sacan directamente del XML real que ya timbro factura.com
// (no se inventa nada): RFC/CURP/NSS, percepciones, deducciones, otros
// pagos, sellos digitales y totales vienen tal cual del CFDI. El domicilio
// del emisor (Patron) no viene en el XML de forma estructurada (el CFDI 4.0
// solo trae el codigo postal en LugarExpedicion), asi que se usa la misma
// constante DOMICILIO_EMPRESA que ya usa timbrar-nomina/index.ts para dar
// de alta a los empleados -- debe mantenerse igual en ambos archivos.
//
// No se incluye la "Cadena Original del complemento de certificacion" --
// esa no es un atributo literal del XML, se reconstruye con una
// transformacion XSLT del SAT que no vale la pena replicar aqui; el Sello
// del CFDI y el Sello del SAT si son atributos directos y si se incluyen
// completos. Ninguno de los dos es obligatorio en la representacion
// impresa (el SAT solo exige folio fiscal + QR + datos basicos), pero se
// agregan para que el recibo se vea igual de completo que el oficial.
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "npm:pdf-lib@1.17.1";
import QRCode from "npm:qrcode@1.5.3";
import { LOGO_PNG_BASE64 } from "./logo_base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const F_PLUGIN = "9d4095c8f7ed5785cb14c0e3b033eeb8252416ed";
const HOST = "https://api.factura.com";
const ENT_LABEL: Record<string, string> = { FLO: "Florida", PUE: "Puebla", HOT: "Hotel" };
function facturacomHeaders(apiKey: string, secretKey: string) {
  return { "Content-Type": "application/json", "F-PLUGIN": F_PLUGIN, "F-Api-Key": apiKey, "F-Secret-Key": secretKey };
}

// Misma constante que timbrar-nomina/index.ts (ver memoria
// project_facturacom_nomina_setup) -- el domicilio del emisor no viene
// estructurado en el XML del CFDI.
const DOMICILIO_EMPRESA: Record<string, { calle: string; no_ext: string; colonia: string; cp: string; municipio: string; estado: string }> = {
  FLO: { calle: "CARRETERA POZA RICA CAZONES", no_ext: "SN", colonia: "LA VICTORIA KM 47", cp: "93523", municipio: "Papantla", estado: "Veracruz" },
  PUE: { calle: "AVENIDA PUEBLA", no_ext: "505", colonia: "PALMA SOLA", cp: "93320", municipio: "Poza Rica de Hidalgo", estado: "Veracruz" },
  HOT: { calle: "AVENIDA PUEBLA", no_ext: "505", colonia: "PALMA SOLA", cp: "93320", municipio: "Poza Rica de Hidalgo", estado: "Veracruz" },
};

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// --- Lectura de atributos del XML por regex (esquema fijo y conocido, no
// hace falta un parser XML completo). ---
function tagAttrs(xml: string, qname: string): string | null {
  const m = xml.match(new RegExp(`<${qname}\\b([^>]*)/?>`, "s"));
  return m ? m[1] : null;
}
function allTagAttrs(xml: string, qname: string): string[] {
  return [...xml.matchAll(new RegExp(`<${qname}\\b([^>]*)/?>`, "gs"))].map((m) => m[1]);
}
function attr(attrsStr: string | null, name: string): string {
  if (!attrsStr) return "";
  const m = attrsStr.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : "";
}
function money(s: string): number {
  return Number(s || 0);
}
function fmxn(n: number): string {
  return "$ " + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface DatosRecibo {
  folioFiscal: string; fechaTimbrado: string; fechaPago: string; folioInterno: string;
  certCsd: string; certSat: string; selloCfdi: string; selloSat: string; metodoPago: string;
  emisorNombre: string; emisorRfc: string; emisorRegimen: string; emisorDomicilio: string;
  receptorNombre: string; receptorRfc: string; receptorRegimen: string;
  numEmpleado: string; curp: string; nss: string; registroPatronal: string;
  puesto: string; departamento: string; diasPagados: string; pagoDesde: string; pagoHasta: string;
  percepciones: { concepto: string; gravado: number; exento: number }[];
  deducciones: { concepto: string; importe: number }[];
  otrosPagos: { concepto: string; importe: number; subsidioCausado: number }[];
  subtotal: number; descuento: number; total: number; totalLetra: string;
  qrTexto: string;
}

function totalEnLetras(total: number): string {
  // Solo se usa como respaldo si no se puede tomar de otro lado -- la
  // representacion en letras no es parte del XML, factura.com la calcula
  // para su propia plantilla. Aqui se omite del recibo si no aplica.
  return "";
}

function extraerDatos(xml: string, entidad: string, empleado: { nombre: string; rfc: string; curp: string; nss: string; puesto: string; departamento: string }, patronal: string): DatosRecibo {
  const comp = tagAttrs(xml, "cfdi:Comprobante");
  const emisor = tagAttrs(xml, "cfdi:Emisor");
  const receptor = tagAttrs(xml, "cfdi:Receptor");
  const nomina = tagAttrs(xml, "nomina12:Nomina");
  const nomEmisor = tagAttrs(xml, "nomina12:Emisor");
  const nomReceptor = tagAttrs(xml, "nomina12:Receptor");
  const tfd = tagAttrs(xml, "tfd:TimbreFiscalDigital");

  const percepciones = allTagAttrs(xml, "nomina12:Percepcion").map((a) => ({
    concepto: attr(a, "Concepto"), gravado: money(attr(a, "ImporteGravado")), exento: money(attr(a, "ImporteExento")),
  }));
  const deducciones = allTagAttrs(xml, "nomina12:Deduccion").map((a) => ({
    concepto: attr(a, "Concepto"), importe: money(attr(a, "Importe")),
  }));
  const otrosPagosAttrs = allTagAttrs(xml, "nomina12:OtroPago");
  const subsidioAttrs = allTagAttrs(xml, "nomina12:SubsidioAlEmpleo");
  const otrosPagos = otrosPagosAttrs.map((a, i) => ({
    concepto: attr(a, "Concepto"), importe: money(attr(a, "Importe")),
    subsidioCausado: money(attr(subsidioAttrs[i] || null, "SubsidioCausado")),
  }));

  const dom = DOMICILIO_EMPRESA[entidad];
  const emisorDomicilio = dom
    ? `${dom.calle} ${dom.no_ext}, Col. ${dom.colonia}, C.P. ${dom.cp}, ${dom.municipio}, ${dom.estado}, México`
    : `C.P. ${attr(comp, "LugarExpedicion")}`;

  const subtotal = money(attr(comp, "SubTotal"));
  const descuento = money(attr(comp, "Descuento"));
  const total = money(attr(comp, "Total"));
  const rfcEmisor = attr(emisor, "Rfc");
  const rfcReceptor = attr(receptor, "Rfc");
  const sello = attr(comp, "Sello");
  const fe = sello.slice(-8);
  const tt = total.toFixed(6).padStart(17, "0"); // 10 enteros + punto + 6 decimales
  const qrTexto = `https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=${attr(tfd, "UUID")}&re=${rfcEmisor}&rr=${rfcReceptor}&tt=${tt}&fe=${fe}`;

  return {
    folioFiscal: attr(tfd, "UUID"), fechaTimbrado: attr(tfd, "FechaTimbrado"), fechaPago: attr(nomina, "FechaPago"),
    folioInterno: attr(comp, "Serie") + " " + attr(comp, "Folio"),
    certCsd: attr(comp, "NoCertificado"), certSat: attr(tfd, "NoCertificadoSAT"),
    selloCfdi: sello, selloSat: attr(tfd, "SelloSAT"), metodoPago: attr(comp, "MetodoPago"),
    emisorNombre: attr(emisor, "Nombre"), emisorRfc: rfcEmisor, emisorRegimen: attr(emisor, "RegimenFiscal"),
    emisorDomicilio,
    receptorNombre: attr(receptor, "Nombre") || empleado.nombre, receptorRfc: rfcReceptor || empleado.rfc,
    receptorRegimen: attr(receptor, "RegimenFiscalReceptor"),
    numEmpleado: attr(nomReceptor, "NumEmpleado"), curp: attr(nomReceptor, "Curp") || empleado.curp,
    nss: attr(nomReceptor, "NumSeguridadSocial") || empleado.nss, registroPatronal: patronal,
    puesto: attr(nomReceptor, "Puesto") || empleado.puesto, departamento: attr(nomReceptor, "Departamento") || empleado.departamento,
    diasPagados: attr(nomina, "NumDiasPagados"), pagoDesde: attr(nomina, "FechaInicialPago"), pagoHasta: attr(nomina, "FechaFinalPago"),
    percepciones, deducciones, otrosPagos,
    subtotal, descuento, total, totalLetra: totalEnLetras(total),
    qrTexto,
  };
}

// --- Colores de marca (Restaurante El Pescador Veracruzano) ---
const TEAL = rgb(0x1c / 255, 0x8a / 255, 0xaf / 255);
const NAVY = rgb(0x00 / 255, 0x3e / 255, 0x53 / 255);
const ORANGE = rgb(0xff / 255, 0x87 / 255, 0x3e / 255);
const GRAY = rgb(0.38, 0.38, 0.38);
const LIGHT = rgb(0.93, 0.96, 0.97);
const WHITE = rgb(1, 1, 1);
const PAGE_W = 595.28, PAGE_H = 841.89, M = 32;

function wrapText(font: PDFFont, text: string, size: number, width: number): string[] {
  const palabras = text.split(" ");
  const lineas: string[] = [];
  let actual = "";
  for (const w of palabras) {
    const prueba = (actual + " " + w).trim();
    if (font.widthOfTextAtSize(prueba, size) <= width) actual = prueba;
    else { if (actual) lineas.push(actual); actual = w; }
  }
  if (actual) lineas.push(actual);
  return lineas.length ? lineas : [""];
}

async function dibujarPagina(
  pdfDoc: PDFDocument, logoImg: Awaited<ReturnType<PDFDocument["embedPng"]>>,
  helv: PDFFont, hebo: PDFFont, cour: PDFFont, d: DatosRecibo,
) {
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const Y = (fromTop: number) => PAGE_H - fromTop;
  const texto = (x: number, yTop: number, s: string, size = 8, font = helv, color = GRAY) =>
    page.drawText(s, { x, y: Y(yTop), size, font, color });
  const rectTop = (x0: number, y0: number, x1: number, y1: number, color: ReturnType<typeof rgb>) =>
    page.drawRectangle({ x: x0, y: Y(y1), width: x1 - x0, height: y1 - y0, color });
  const lineTop = (x0: number, yTop: number, x1: number, color = rgb(0.85, 0.85, 0.85), thickness = 0.6) =>
    page.drawLine({ start: { x: x0, y: Y(yTop) }, end: { x: x1, y: Y(yTop) }, thickness, color });

  // --- Encabezado ---
  rectTop(0, 0, PAGE_W, 92, NAVY);
  const logoDims = logoImg.scale(1);
  const logoSize = 64;
  page.drawImage(logoImg, { x: M, y: Y(78), width: logoSize, height: logoSize * (logoDims.height / logoDims.width) <= logoSize ? logoSize : logoSize });
  texto(M + 76, 38, "Recibo de Nómina", 17, hebo, WHITE);
  texto(M + 76, 56, "El Pescador Veracruzano", 10, helv, TEAL);
  texto(M + 76, 72, `Folio: ${d.folioInterno}  ·  Timbrado: ${d.fechaTimbrado}`, 8, helv, rgb(0.85, 0.9, 0.92));

  const qrPng = await QRCode.toBuffer(d.qrTexto, { type: "png", margin: 1, width: 300 });
  const qrImg = await pdfDoc.embedPng(qrPng);
  page.drawImage(qrImg, { x: PAGE_W - M - 62, y: Y(74), width: 62, height: 62 });

  let y = 122;
  const seccion = (titulo: string, yTop: number) => {
    rectTop(M, yTop, PAGE_W - M, yTop + 15, TEAL);
    texto(M + 6, yTop + 11, titulo, 9, hebo, WHITE);
    return yTop + 15;
  };

  // --- Emisor / Receptor ---
  const colW = (PAGE_W - 2 * M - 10) / 2;
  y = seccion("EMISOR (PATRÓN)", y);
  const yr = y;
  texto(M + 4, yr + 12, d.emisorNombre, 9, hebo, NAVY);
  texto(M + 4, yr + 23, `RFC: ${d.emisorRfc}   Régimen: ${d.emisorRegimen}`, 7.5);
  const lineasDomE = wrapText(helv, d.emisorDomicilio, 7.5, colW - 8);
  lineasDomE.forEach((l, k) => texto(M + 4, yr + 34 + k * 9, l, 7.5));

  const x2 = M + colW + 10;
  rectTop(x2, y - 15, PAGE_W - M, y, TEAL);
  texto(x2 + 6, y - 4, "RECEPTOR (EMPLEADO)", 9, hebo, WHITE);
  texto(x2 + 4, yr + 12, d.receptorNombre, 9, hebo, NAVY);
  texto(x2 + 4, yr + 23, `RFC: ${d.receptorRfc}`, 7.5);
  const lineasPuestoR = wrapText(helv, `Puesto: ${d.puesto}   Depto: ${d.departamento}`, 7.5, colW - 8);
  lineasPuestoR.forEach((l, k) => texto(x2 + 4, yr + 34 + k * 9, l, 7.5));

  y = yr + 34 + Math.max(lineasDomE.length, lineasPuestoR.length) * 9 + 4;
  lineTop(M, y, PAGE_W - M);
  y += 10;
  texto(M + 4, y, `No. empleado: ${d.numEmpleado}   Periodo: DEL ${d.pagoDesde} AL ${d.pagoHasta}   Días pagados: ${d.diasPagados}`, 7.5);
  y += 11;
  texto(M + 4, y, `NSS: ${d.nss}`, 7.5);
  y += 11;
  texto(M + 4, y, `CURP: ${d.curp}   Reg. Patronal: ${d.registroPatronal}`, 7.5);
  y += 18;

  // --- Tablas ---
  const tabla = (titulo: string, yTop: number, cols: string[], widths: number[], filas: string[][]) => {
    let yy = seccion(titulo, yTop);
    rectTop(M, yy, PAGE_W - M, yy + 13, LIGHT);
    let x = M + 4;
    cols.forEach((c, i) => { texto(x, yy + 9, c, 7, hebo, NAVY); x += widths[i]; });
    yy += 13;
    for (const fila of filas) {
      x = M + 4;
      fila.forEach((v, i) => { texto(x, yy + 10, v, 7.5); x += widths[i]; });
      yy += 13;
    }
    return yy + 6;
  };

  if (d.percepciones.length) {
    y = tabla("PERCEPCIONES", y, ["Descripción", "Gravado", "Exento"], [280, 100, 100],
      d.percepciones.map((p) => [p.concepto, fmxn(p.gravado), fmxn(p.exento)]));
  }
  if (d.deducciones.length) {
    y = tabla("DEDUCCIONES", y, ["Descripción", "Importe"], [380, 100],
      d.deducciones.map((p) => [p.concepto, fmxn(p.importe)]));
  }
  if (d.otrosPagos.length) {
    y = tabla("OTROS PAGOS", y, ["Descripción", "Importe", "Subsidio causado"], [280, 100, 100],
      d.otrosPagos.map((p) => [p.concepto, fmxn(p.importe), fmxn(p.subsidioCausado)]));
  }

  // --- Totales ---
  const boxW = 200, boxH = 50;
  const bx = PAGE_W - M - boxW, by = y;
  page.drawRectangle({ x: bx, y: Y(by + boxH), width: boxW, height: boxH, color: LIGHT, borderColor: NAVY, borderWidth: 1 });
  let ty = by + 16;
  texto(bx + 10, ty, "Subtotal:", 8); texto(bx + boxW - 70, ty, fmxn(d.subtotal), 8); ty += 14;
  if (d.descuento) { texto(bx + 10, ty, "Total deducciones:", 8); texto(bx + boxW - 70, ty, "- " + fmxn(d.descuento), 8); ty += 14; }
  rectTop(bx, ty - 2, bx + boxW, ty + 16, NAVY);
  texto(bx + 10, ty + 11, "TOTAL:", 10, hebo, WHITE);
  texto(bx + boxW - 80, ty + 11, fmxn(d.total), 10, hebo, ORANGE);

  texto(M, by + boxH + 10, `Método de pago: ${d.metodoPago}   ·   Fecha de pago: ${d.fechaPago}`, 7.5);

  // --- Firma ---
  const firmaY = by + boxH + 36;
  lineTop(M, firmaY, M + 230, NAVY, 0.8);
  texto(M, firmaY + 11, "FIRMA DEL TRABAJADOR — recibí de conformidad", 7, helv, GRAY);

  // --- Comprobante fiscal ---
  let y2 = seccion("COMPROBANTE FISCAL DIGITAL POR INTERNET", firmaY + 26);
  const filasFiscales: [string, string][] = [
    ["Folio Fiscal (UUID):", d.folioFiscal],
    ["Fecha y hora de certificación:", d.fechaTimbrado],
    ["Serie y folio interno:", d.folioInterno],
    ["No. Serie del CSD emisor:", d.certCsd],
    ["No. Serie del CSD del SAT:", d.certSat],
    ["Forma de pago:", d.metodoPago],
  ];
  const col2W = (PAGE_W - 2 * M) / 2;
  const yy0 = y2 + 10;
  filasFiscales.forEach(([label, val], idx) => {
    const colx = idx % 2 === 0 ? M : M + col2W;
    const rowY = yy0 + Math.floor(idx / 2) * 11;
    texto(colx, rowY, label, 6.5, hebo, NAVY);
    const lx = colx + hebo.widthOfTextAtSize(label, 6.5) + 6;
    texto(lx, rowY, val, 6.5, helv, GRAY);
  });
  let y3 = yy0 + Math.ceil(filasFiscales.length / 2) * 11 + 14;

  const bloqueMono = (titulo: string, textoLargo: string, yTop: number) => {
    if (!textoLargo) return yTop;
    texto(M, yTop, titulo, 6.8, hebo, NAVY);
    let yy = yTop + 9;
    const charsLinea = Math.max(40, Math.floor((PAGE_W - 2 * M) / (0.6 * 6.2)));
    for (let i = 0; i < textoLargo.length; i += charsLinea) {
      texto(M, yy, textoLargo.slice(i, i + charsLinea), 6.2, cour, GRAY);
      yy += 7.5;
    }
    return yy + 5;
  };
  y3 = bloqueMono("Sello digital del CFDI:", d.selloCfdi, y3);
  y3 = bloqueMono("Sello digital del SAT:", d.selloSat, y3);

  lineTop(M, y3, PAGE_W - M);
  texto(M, y3 + 11, "Este documento es una representación impresa de un CFDI — Versión 4.0", 6.5, helv, GRAY);
  texto(M, y3 + 21, "Versión compacta generada por Oficina Pescador a partir del CFDI timbrado por factura.com.", 6, helv, GRAY);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SERVICE_ROLE_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller) return json({ error: "Sesión inválida" }, 401);
    const { data: callerPerfil } = await callerClient.from("perfiles").select("rol").eq("id", caller.id).single();
    if (!callerPerfil || (callerPerfil.rol !== "admin" && callerPerfil.rol !== "oficinista")) {
      return json({ error: "No tienes permiso para descargar recibos" }, 403);
    }

    const { periodo_id } = await req.json().catch(() => ({}));
    if (!periodo_id) return json({ error: "Falta periodo_id" }, 400);

    const db = createClient(supabaseUrl, serviceKey);
    const { data: periodo } = await db.from("nomina_periodos").select("*").eq("id", periodo_id).single();
    if (!periodo) return json({ error: "No se encontró el periodo" }, 404);
    const ent: string = periodo.entidad;

    const { data: cred } = await db.from("facturacom_credenciales").select("*").eq("entidad", ent).maybeSingle();
    if (!cred?.api_key || !cred?.secret_key) return json({ error: `Faltan las llaves de factura.com para ${ENT_LABEL[ent] || ent}` }, 500);
    const headers = facturacomHeaders(cred.api_key, cred.secret_key);

    const { data: lineas } = await db.from("nomina_lineas")
      .select("*, empleados(nombre,rfc,curp,nss,puesto_id,facturacom_uid)")
      .eq("periodo_id", periodo_id).eq("facturacom_status", "timbrada");
    if (!lineas || !lineas.length) return json({ error: "No hay líneas timbradas en este periodo" }, 400);

    const { data: puestos } = await db.from("puestos").select("id,nombre");
    const puestoNombre = (id: string | null) => puestos?.find((p) => p.id === id)?.nombre || "";

    const pdfDoc = await PDFDocument.create();
    const logoImg = await pdfDoc.embedPng(base64ToBytes(LOGO_PNG_BASE64));
    const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const hebo = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const cour = await pdfDoc.embedFont(StandardFonts.Courier);

    const errores: string[] = [];
    for (const l of lineas) {
      const e = l.empleados as any;
      try {
        let itemUid: string | null = l.facturacom_item_uid;
        if (!itemUid) {
          const viewRes = await fetch(`${HOST}/payroll/${l.facturacom_nomina_uid}/view`, { headers });
          const viewData = await viewRes.json();
          const registros: any[] = viewData?.data?.registros || [];
          const reg = registros.find((r) => r.uuid === l.facturacom_uuid) ||
            registros.find((r) => r.employee_uid === e.facturacom_uid) ||
            registros.find((r) => r.data?.nombre === e.nombre);
          itemUid = reg?.uid || null;
        }
        if (!itemUid) { errores.push(`${e.nombre}: no se encontró el identificador del CFDI`); continue; }

        const xmlRes = await fetch(`${HOST}/payroll/${itemUid}/item/xml`, { headers });
        const xml = await xmlRes.text();
        if (!xml.includes("cfdi:Comprobante")) { errores.push(`${e.nombre}: no se pudo descargar el XML`); continue; }

        const datos = extraerDatos(xml, ent, {
          nombre: e.nombre, rfc: e.rfc, curp: e.curp, nss: e.nss,
          puesto: puestoNombre(e.puesto_id), departamento: ENT_LABEL[ent] || ent,
        }, cred.patronal || "");
        await dibujarPagina(pdfDoc, logoImg, helv, hebo, cour, datos);
      } catch (err) {
        errores.push(`${e?.nombre || l.id}: ${err instanceof Error ? err.message : "error inesperado"}`);
      }
    }

    if (pdfDoc.getPageCount() === 0) {
      return json({ error: "No se pudo generar ningún recibo", detalle: errores }, 500);
    }

    const pdfBytes = await pdfDoc.save();
    const nombre = `recibos_nomina_${ENT_LABEL[ent] || ent}_${periodo.semana_inicio}.pdf`;
    return new Response(pdfBytes, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${nombre}"`,
        "X-Errores": errores.length ? encodeURIComponent(JSON.stringify(errores)) : "",
      },
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error inesperado" }, 500);
  }
});
