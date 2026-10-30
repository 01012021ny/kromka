// Production exports: tiled A4 PDF at 1:1, DXF (AAMA/ASTM D6673-style blocks), HPGL/PLT, ZIP container, SVG with size nest
import { cutOutline, edgePts, seamOf } from './patterns.js';
import { bbox, centroid, fmt, esc, polyLen } from './util.js';
import { gradeGarment, sizesOf } from './grading.js';
import { nestMaterial } from './layout.js';

// ───────── collect what to export ─────────
export function exportSets(app, { garments, sizes }) {
  const sets = [];
  const M = app.body.m;
  for (const g of app.S.garments) {
    if (garments && !garments.includes(g.id)) continue;
    if (g.visible === false) continue;
    const base = g.grading?.base || 'M';
    for (const sz of sizesOf(g)) {
      if (sizes && !sizes.includes(sz)) continue;
      const pieces = (sz === base ? g.pieces : gradeGarment(g, M, sz)).filter((p) => !p.hidden);
      sets.push({ g, size: sz, pieces });
    }
  }
  return sets;
}

// compact arrangement for paper / plotter: the nester with free rotation (paper has no grain); returns affine per piece
export function printLayout(sets, rowW = 110, gap = 1.5) {
  const src = [];
  for (const s of sets) for (const p of s.pieces) src.push({ id: s.size + ':' + p.id, set: s, p, poly: cutOutline(p), grain: 0 });
  const r = nestMaterial(src, { width: rowW, cons: 'plain', gsm: 1, shrink: null, price: 0 }, { shrink: false, rotate: true, gap, angles: [0, 90] });
  const items = [];
  for (const pl of r.placed) {
    if (pl.fail) continue;
    const it = pl.it, f = pl.m; // fabric (u,v) = f·(x,y); print: X = v, Y = −u
    const m = [f[1], -f[0], f[3], -f[2], f[5], -f[4]];
    items.push({ set: it.set, p: it.p, co: it.poly, m, ox: 0, oy: 0, world: it.poly.map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]) });
  }
  const all = items.flatMap((it) => it.world);
  return { items, bb: bbox(all.length ? all : [[0, 0]]) };
}

// draw one piece in world cm (y up) into a 2D context already transformed
function drawPiece(c, it, px, mats, opts = {}) {
  const { p, set } = it;
  c.save(); if (it.m) c.transform(it.m[0], it.m[1], it.m[2], it.m[3], it.m[4], it.m[5]); else c.translate(it.ox, it.oy);
  const pth = (pts) => { c.beginPath(); pts.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); c.closePath(); };
  pth(it.co); c.strokeStyle = '#000'; c.lineWidth = 2.2 * px; c.setLineDash([]); c.stroke();
  pth(p.pts); c.lineWidth = 1 * px; c.setLineDash([6 * px, 4 * px]); c.stroke(); c.setLineDash([]);
  for (const o of p.overlays || []) { pth(o.pts); c.lineWidth = 0.8 * px; c.setLineDash([3 * px, 3 * px]); c.stroke(); c.setLineDash([]); }
  // notches + seam letters
  for (let k = 0; k < p.corners.length; k++) {
    const cid = p.corners[k].id, sm = seamOf(set.g, p.id, cid);
    if (!sm) continue;
    const e = edgePts(p, k), mi = Math.floor(e.length / 2), m = e[mi];
    const a = e[Math.max(0, mi - 1)], b = e[Math.min(e.length - 1, mi + 1)];
    let nx = b[1] - a[1], ny = -(b[0] - a[0]); const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    const sa = p.meta[cid]?.sa ?? 1;
    c.beginPath(); c.moveTo(m[0], m[1]); c.lineTo(m[0] + nx * (sa + 0.05), m[1] + ny * (sa + 0.05)); c.lineWidth = 2 * px; c.stroke();
    const idx = set.g.seams.indexOf(sm);
    text(c, String.fromCharCode(65 + (idx % 26)) + (idx >= 26 ? Math.floor(idx / 26) : ''), m[0] - nx * 1.3, m[1] - ny * 1.3, px, 11, '600');
  }
  // grain
  const ct = centroid(p.pts), bb = bbox(p.pts), ga = ((p.grain || 0) * Math.PI) / 180, gl = Math.min(bb.h, bb.w) * 0.32;
  const gx = Math.sin(ga) * gl, gy = Math.cos(ga) * gl;
  c.lineWidth = 1.2 * px;
  c.beginPath(); c.moveTo(ct[0] - gx, ct[1] - gy); c.lineTo(ct[0] + gx, ct[1] + gy); c.stroke();
  for (const s of [1, -1]) { const tx = ct[0] + s * gx, ty = ct[1] + s * gy; c.beginPath(); c.moveTo(tx, ty); c.lineTo(tx - s * Math.sin(ga) * 1.4 + Math.cos(ga) * 0.6, ty - s * Math.cos(ga) * 1.4 - Math.sin(ga) * 0.6); c.moveTo(tx, ty); c.lineTo(tx - s * Math.sin(ga) * 1.4 - Math.cos(ga) * 0.6, ty - s * Math.cos(ga) * 1.4 + Math.sin(ga) * 0.6); c.stroke(); }
  const mat = mats[p.mat];
  text(c, p.name, ct[0] + 1.2, ct[1] + 3, px, 15, '700', 'left');
  text(c, `${set.g.name} · размер ${set.size}`, ct[0] + 1.2, ct[1] + 1.2, px, 11, '400', 'left');
  text(c, `${mat ? mat.name : ''} · крой 1 · нить ${p.grain || 0}°`, ct[0] + 1.2, ct[1] - 0.4, px, 11, '400', 'left');
  if (opts.lengths) for (let k = 0; k < p.corners.length; k++) { const e = edgePts(p, k), m = e[Math.floor(e.length / 2)]; text(c, fmt(polyLen(e)), m[0], m[1], px, 9, '400'); }
  c.restore();
}
function text(c, s, x, y, px, size, weight = '400', align = 'center') {
  c.save(); c.translate(x, y); c.scale(px, -px);
  c.font = `${weight} ${size}px "Inter Tight", Arial, sans-serif`; c.fillStyle = '#000'; c.textAlign = align; c.textBaseline = 'middle';
  c.fillText(s, 0, 0); c.restore();
}

// ───────── PDF (A4 tiles, 1:1) ─────────
export async function pdfTiles(app, sets, dpi = 150) {
  const L = printLayout(sets, 114);
  const mats = app.matsById();
  const PW = 21, PH = 29.7, MG = 1.0, FOOT = 1.4; // cm
  const TW = PW - 2 * MG, TH = PH - 2 * MG - FOOT;
  const cols = Math.max(1, Math.ceil(L.bb.w / TW)), rows = Math.max(1, Math.ceil(L.bb.h / TH));
  const pxcm = dpi / 2.54, W = Math.round(PW * pxcm), H = Math.round(PH * pxcm);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const pages = [];
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
    const wx0 = L.bb.x0 + q * TW, wy1 = L.bb.y1 - r * TH; // tile top-left in world
    const used = L.items.some((it) => { const b = bbox(it.world); return b.x1 > wx0 && b.x0 < wx0 + TW && b.y0 < wy1 && b.y1 > wy1 - TH; });
    if (!used) continue;
    c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
    // tile frame
    c.strokeStyle = '#999'; c.lineWidth = 1; c.setLineDash([4, 4]); c.strokeRect(MG * pxcm, MG * pxcm, TW * pxcm, TH * pxcm); c.setLineDash([]);
    // registration crosses
    c.strokeStyle = '#000'; c.lineWidth = 1.2;
    for (const [cx, cy] of [[MG, MG], [MG + TW, MG], [MG, MG + TH], [MG + TW, MG + TH]]) { c.beginPath(); c.moveTo((cx - 0.6) * pxcm, cy * pxcm); c.lineTo((cx + 0.6) * pxcm, cy * pxcm); c.moveTo(cx * pxcm, (cy - 0.6) * pxcm); c.lineTo(cx * pxcm, (cy + 0.6) * pxcm); c.stroke(); }
    // content clipped to tile
    c.save();
    c.beginPath(); c.rect(MG * pxcm, MG * pxcm, TW * pxcm, TH * pxcm); c.clip();
    c.setTransform(pxcm, 0, 0, -pxcm, (MG - wx0) * pxcm, (MG + wy1) * pxcm);
    for (const it of L.items) drawPiece(c, it, 1 / pxcm, mats);
    c.restore();
    // footer: id, neighbours, 10 cm ruler
    c.setTransform(1, 0, 0, 1, 0, 0);
    const id = letters[r % 26] + (q + 1);
    c.fillStyle = '#000'; c.font = `600 ${Math.round(0.42 * pxcm)}px Arial`; c.textBaseline = 'middle';
    const fy = (PH - MG - FOOT / 2) * pxcm;
    c.fillText(`ЛИСТ ${id}  ·  ${rows}×${cols}  ·  МАСШТАБ 1:1`, MG * pxcm, fy);
    c.font = `${Math.round(0.3 * pxcm)}px Arial`;
    c.fillText(`↑ ${r > 0 ? letters[(r - 1) % 26] + (q + 1) : '—'}   ← ${q > 0 ? letters[r % 26] + q : '—'}   → ${q < cols - 1 ? letters[r % 26] + (q + 2) : '—'}   ↓ ${r < rows - 1 ? letters[(r + 1) % 26] + (q + 1) : '—'}   КРОМКА`, MG * pxcm, fy + 0.45 * pxcm);
    const rx = (PW - MG - 10) * pxcm;
    c.fillRect(rx, fy - 0.08 * pxcm, 10 * pxcm, 0.16 * pxcm);
    for (let i = 0; i <= 10; i++) c.fillRect(rx + i * pxcm - 1, fy - 0.3 * pxcm, 2, i % 5 ? 0.22 * pxcm : 0.38 * pxcm);
    c.font = `${Math.round(0.28 * pxcm)}px Arial`; c.fillText('проверка: 10 см', rx, fy + 0.45 * pxcm);
    const gray = new Uint8Array(W * H), img = c.getImageData(0, 0, W, H).data;
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (img[j] * 0.3 + img[j + 1] * 0.59 + img[j + 2] * 0.11) | 0;
    pages.push({ gray, W, H });
  }
  const objs = [];
  const enc = new TextEncoder();
  const deflate = async (u8) => {
    if (typeof CompressionStream === 'undefined') return null;
    const cs = new CompressionStream('deflate');
    const out = new Response(new Blob([u8]).stream().pipeThrough(cs)).arrayBuffer();
    return new Uint8Array(await out);
  };
  const ptW = (PW / 2.54) * 72, ptH = (PH / 2.54) * 72;
  const pageIds = [];
  for (const pg of pages) {
    const data = (await deflate(pg.gray)) || pg.gray;
    const filt = data === pg.gray ? '' : '/Filter /FlateDecode ';
    const imgId = objs.length + 3;
    objs.push({ head: `<< /Type /XObject /Subtype /Image /Width ${pg.W} /Height ${pg.H} /ColorSpace /DeviceGray /BitsPerComponent 8 ${filt}/Length ${data.length} >>`, stream: data });
    const content = enc.encode(`q ${ptW.toFixed(2)} 0 0 ${ptH.toFixed(2)} 0 0 cm /Im0 Do Q`);
    objs.push({ head: `<< /Length ${content.length} >>`, stream: content });
    objs.push({ head: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW.toFixed(2)} ${ptH.toFixed(2)}] /Resources << /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${imgId + 1} 0 R >>` });
    pageIds.push(imgId + 2);
  }
  const all = [{ head: '<< /Type /Catalog /Pages 2 0 R >>' }, { head: `<< /Type /Pages /Kids [${pageIds.map((i) => i + ' 0 R').join(' ')}] /Count ${pageIds.length} >>` }, ...objs];
  const chunks = [enc.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
  let off = chunks[0].length;
  const xref = [];
  all.forEach((o, i) => {
    xref.push(off);
    const h = enc.encode(`${i + 1} 0 obj\n${o.head}\n`);
    chunks.push(h); off += h.length;
    if (o.stream) { const s1 = enc.encode('stream\n'), s2 = enc.encode('\nendstream\n'); chunks.push(s1, o.stream, s2); off += s1.length + o.stream.length + s2.length; }
    const e = enc.encode('endobj\n'); chunks.push(e); off += e.length;
  });
  const xs = `xref\n0 ${all.length + 1}\n0000000000 65535 f \n${xref.map((x) => String(x).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${all.length + 1} /Root 1 0 R >>\nstartxref\n${off}\n%%EOF`;
  chunks.push(enc.encode(xs));
  return { blob: new Blob(chunks, { type: 'application/pdf' }), pages: pages.length, rows, cols };
}

// ───────── DXF (AAMA-style) ─────────
const uEsc = (s) => [...String(s)].map((ch) => (ch.charCodeAt(0) < 128 ? ch : '\\U+' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'))).join('');
export function dxf(app, sets) {
  const mats = app.matsById();
  const out = [];
  const w = (code, val) => out.push(String(code), String(val));
  w(0, 'SECTION'); w(2, 'HEADER'); w(9, '$ACADVER'); w(1, 'AC1009'); w(9, '$INSBASE'); w(10, 0); w(20, 0); w(30, 0); w(9, '$MEASUREMENT'); w(70, 1); w(0, 'ENDSEC');
  w(0, 'SECTION'); w(2, 'TABLES'); w(0, 'TABLE'); w(2, 'LAYER'); w(70, 6);
  for (const [n, col] of [['1', 7], ['4', 3], ['7', 5], ['8', 2], ['14', 1], ['15', 6]]) { w(0, 'LAYER'); w(2, n); w(70, 0); w(62, col); w(6, 'CONTINUOUS'); }
  w(0, 'ENDTAB'); w(0, 'ENDSEC');
  const L = printLayout(sets, 160, 2);
  const poly = (layer, pts, closed = true) => { w(0, 'POLYLINE'); w(8, layer); w(66, 1); w(70, closed ? 1 : 0); for (const [x, y] of pts) { w(0, 'VERTEX'); w(8, layer); w(10, fmt(x * 10, 2)); w(20, fmt(y * 10, 2)); } w(0, 'SEQEND'); w(8, layer); };
  const line = (layer, a, b) => { w(0, 'LINE'); w(8, layer); w(10, fmt(a[0] * 10, 2)); w(20, fmt(a[1] * 10, 2)); w(11, fmt(b[0] * 10, 2)); w(21, fmt(b[1] * 10, 2)); };
  const txt = (s, x, y, hgt = 5) => { w(0, 'TEXT'); w(8, '15'); w(10, fmt(x * 10, 2)); w(20, fmt(y * 10, 2)); w(40, hgt); w(1, uEsc(s)); };
  w(0, 'SECTION'); w(2, 'BLOCKS');
  const names = [];
  L.items.forEach((it, i) => {
    const { p, set } = it;
    const bn = `P${i + 1}_${set.size}`;
    names.push([bn, it]);
    w(0, 'BLOCK'); w(8, '0'); w(2, bn); w(70, 0); w(10, 0); w(20, 0); w(30, 0); w(3, bn);
    poly('1', it.co);
    poly('14', p.pts);
    for (const o of p.overlays || []) poly('8', o.pts);
    const ct = centroid(p.pts), bb = bbox(p.pts), ga = ((p.grain || 0) * Math.PI) / 180, gl = Math.min(bb.h, bb.w) * 0.32;
    line('7', [ct[0] - Math.sin(ga) * gl, ct[1] - Math.cos(ga) * gl], [ct[0] + Math.sin(ga) * gl, ct[1] + Math.cos(ga) * gl]);
    for (let k = 0; k < p.corners.length; k++) {
      const cid = p.corners[k].id; if (!seamOf(set.g, p.id, cid)) continue;
      const e = edgePts(p, k), mi = Math.floor(e.length / 2), m = e[mi], a = e[Math.max(0, mi - 1)], b = e[Math.min(e.length - 1, mi + 1)];
      let nx = b[1] - a[1], ny = -(b[0] - a[0]); const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      const sa = p.meta[cid]?.sa ?? 1;
      line('4', [m[0] + nx * sa, m[1] + ny * sa], [m[0] + nx * (sa - 0.6), m[1] + ny * (sa - 0.6)]);
    }
    txt(`Piece Name: ${p.name}`, ct[0], ct[1] + 3);
    txt(`Size: ${set.size}`, ct[0], ct[1] + 1.8);
    txt(`Quantity: 1`, ct[0], ct[1] + 0.6);
    txt(`Material: ${mats[p.mat]?.name || ''}`, ct[0], ct[1] - 0.6);
    txt(`Style: ${set.g.name}`, ct[0], ct[1] - 1.8);
    w(0, 'ENDBLK'); w(8, '0');
  });
  w(0, 'ENDSEC');
  w(0, 'SECTION'); w(2, 'ENTITIES');
  for (const [bn, it] of names) { const m = it.m; w(0, 'INSERT'); w(8, '0'); w(2, bn); w(10, fmt(m[4] * 10, 2)); w(20, fmt(m[5] * 10, 2)); w(30, 0); w(50, fmt((Math.atan2(m[1], m[0]) * 180) / Math.PI, 3)); }
  w(0, 'ENDSEC'); w(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}

// ───────── HPGL / PLT ─────────
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
export const translit = (s) => [...String(s)].map((ch) => { const l = ch.toLowerCase(); const t = TR[l]; if (t === undefined) return ch.charCodeAt(0) < 128 ? ch : '?'; return ch === l ? t : t.charAt(0).toUpperCase() + t.slice(1); }).join('');
export function plt(app, sets) {
  const L = printLayout(sets, 160, 2);
  const U = 400; // plotter units per cm (0.025 mm)
  const ox = -L.bb.x0, oy = -L.bb.y0;
  const P = (x, y) => `${Math.round((x + ox) * U)},${Math.round((y + oy) * U)}`;
  const cmds = ['IN', 'SP1', 'DT\x03', 'SI0.25,0.35'];
  for (const it of L.items) {
    const m = it.m;
    const ptsW = (pts) => pts.map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
    for (const [pen, pts] of [[1, ptsW(it.co)], [2, ptsW(it.p.pts)]]) {
      cmds.push('SP' + pen, 'PU' + P(...pts[0]), 'PD' + pts.slice(1).concat([pts[0]]).map((q) => P(...q)).join(','));
    }
    const ct = centroid(it.p.pts);
    const cw = ptsW([ct])[0];
    cmds.push('SP1', 'PU' + P(cw[0], cw[1]), 'LB' + translit(`${it.p.name} ${it.set.size}`) + '\x03');
  }
  cmds.push('PU', 'SP0', 'IN');
  return cmds.join(';') + ';';
}

// ───────── ZIP (store) ─────────
let crcT;
function crc32(u8) {
  if (!crcT) { crcT = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; } }
  let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = crcT[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
}
export function zip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const name = enc.encode(f.name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  }
  const csize = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}

// ───────── SVG (1:1, sizes nested) ─────────
export function svgNest(app, sets) {
  // group sets by garment so that sizes overlay each other at the same place
  const mats = app.matsById();
  const byG = new Map();
  for (const s of sets) { if (!byG.has(s.g.id)) byG.set(s.g.id, []); byG.get(s.g.id).push(s); }
  const parts = [];
  const allPts = [];
  let cursorY = 0;
  const blocks = [];
  for (const [, list] of byG) {
    const base = list.find((s) => s.size === (s.g.grading?.base || 'M')) || list[0];
    let x = 0, rowH = 0;
    const offs = {};
    for (const p of base.pieces) {
      const bb = bbox(list.flatMap((s) => { const q = s.pieces.find((z) => z.id === p.id); return q ? cutOutline(q) : []; }));
      offs[p.id] = [x - bb.x0, -cursorY - bb.y1];
      x += bb.w + 4; rowH = Math.max(rowH, bb.h);
    }
    blocks.push({ list, offs });
    cursorY += rowH + 8;
  }
  for (const { list, offs } of blocks) for (const s of list) for (const p of s.pieces) { const o = offs[p.id]; if (!o) continue; for (const q of cutOutline(p)) allPts.push([q[0] + o[0], q[1] + o[1]]); }
  const bb = bbox(allPts.length ? allPts : [[0, 0]]);
  const pad = 5, W = bb.w + pad * 2, H = bb.h + pad * 2;
  const T = (x, y) => `${fmt(x - bb.x0 + pad, 2)},${fmt(bb.y1 - y + pad, 2)}`;
  for (const { list, offs } of blocks) {
    const nS = list.length;
    list.forEach((s, si) => {
      const isBase = s.size === (s.g.grading?.base || 'M');
      for (const p of s.pieces) {
        const o = offs[p.id]; if (!o) continue;
        const sh = (pts) => pts.map(([x, y]) => T(x + o[0], y + o[1])).join(' ');
        parts.push(`<g id="${p.id}_${s.size}"><title>${esc(s.g.name)} — ${esc(p.name)} — ${s.size}</title>`);
        parts.push(`<polygon points="${sh(cutOutline(p))}" fill="none" stroke="#000" stroke-width="${isBase ? 0.08 : 0.04}" ${isBase ? '' : `stroke-dasharray="${0.4 + si * 0.15} 0.25"`}/>`);
        if (isBase || nS === 1) parts.push(`<polygon points="${sh(p.pts)}" fill="none" stroke="#000" stroke-width="0.04" stroke-dasharray="0.6 0.3"/>`);
        const c0 = p.pts[p.corners[0].i];
        parts.push(`<text x="${T(c0[0] + o[0], c0[1] + o[1]).split(',')[0]}" y="${T(c0[0] + o[0], c0[1] + o[1]).split(',')[1]}" font-size="0.8" font-family="monospace">${s.size}</text>`);
        if (isBase) { const ct = centroid(p.pts); const [lx, ly] = T(ct[0] + o[0], ct[1] + o[1]).split(','); parts.push(`<text x="${lx}" y="${ly}" font-size="1.3" text-anchor="middle" font-family="sans-serif">${esc(p.name)}</text><text x="${lx}" y="${+ly + 1.6}" font-size="0.8" text-anchor="middle" font-family="monospace">${esc(s.g.name)} · ${esc(mats[p.mat]?.name || '')} · размеры ${list.map((z) => z.size).join(' ')}</text>`); }
        parts.push('</g>');
      }
    });
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(W * 10, 1)}mm" height="${fmt(H * 10, 1)}mm" viewBox="0 0 ${fmt(W, 2)} ${fmt(H, 2)}">
<!-- КРОМКА: масштаб 1:1, единицы viewBox = см. Сплошная — линия кроя базового размера, пунктир разной частоты — остальные размеры. -->
<rect x="${pad}" y="${fmt(H - pad - 1, 2)}" width="10" height="0.15"/><text x="${pad}" y="${fmt(H - pad - 1.4, 2)}" font-size="0.9" font-family="monospace">контроль: 10 см</text>
${parts.join('\n')}
</svg>`;
}
