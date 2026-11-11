// @ts-check
// Production exports: vector PDF at 1:1 (A4 tiles or A0 sheets), DXF (AAMA/ASTM D6673-style blocks), HPGL/PLT, ZIP container, SVG with size nest
import { cutOutline, edgePts, seamOf, overlayPiece } from './patterns.js';
import { bbox, centroid, fmt, esc, polyLen } from './util.js';
import { gradeGarment, sizesOf } from './grading.js';
import { nestMaterial } from './layout.js';

// ───────── collect what to export ─────────
// shrink: увеличить детали на усадку их ткани (для garment dye / стирки после пошива), отдельно по долевой и поперёк
export function shrinkScale(p, mat) {
  const sl = (mat?.shrink?.[0] || 0) / 100, sw = (mat?.shrink?.[1] || 0) / 100;
  const kx = 1 / (1 - sw), ky = 1 / (1 - sl);
  if (kx === 1 && ky === 1) return p;
  const g = ((p.grain || 0) * Math.PI) / 180, c = Math.cos(g), s = Math.sin(g);
  // масштаб в осях нити детали: поворот → масштаб → обратный поворот
  const f = ([x, y]) => { const u = x * c - y * s, v = x * s + y * c; const U = u * kx, V = v * ky; return [U * c + V * s, -U * s + V * c]; };
  return { ...p, pts: p.pts.map(f), overlays: (p.overlays || []).map((o) => ({ ...o, pts: o.pts.map(f) })) };
}
export function exportSets(app, { garments, sizes, shrink = false }) {
  const sets = [];
  const M = app.body.m;
  const mats = shrink ? app.matsById() : null;
  for (const g of app.S.garments) {
    if (garments && !garments.includes(g.id)) continue;
    if (g.visible === false) continue;
    const base = g.grading?.base || 'M';
    for (const sz of sizesOf(g)) {
      if (sizes && !sizes.includes(sz)) continue;
      let pieces = (sz === base ? g.pieces : gradeGarment(g, M, sz)).filter((p) => !p.hidden);
      // накладки (карманы, вставки) кроятся отдельно — добавляем их как детали; на основной детали остаются метками
      pieces = pieces.flatMap((p) => [p, ...(p.overlays || []).filter((o) => !o.hidden).map((o) => overlayPiece(o, p))]);
      if (shrink) pieces = pieces.map((p) => shrinkScale(p, mats[p.mat]));
      sets.push({ g, size: sz, pieces, shrink });
    }
  }
  return sets;
}

// compact arrangement for paper / plotter: the nester with free rotation (paper has no grain); returns affine per piece
export function printLayout(sets, rowW = 110, gap = 1.5, only = null) {
  let src = only;
  if (!src) { src = []; for (const s of sets) for (const p of s.pieces) src.push({ id: s.size + ':' + p.id, set: s, p, poly: cutOutline(p), grain: 0 }); }
  const r = nestMaterial(src, { width: rowW, cons: 'plain', gsm: 1, shrink: null, price: 0 }, { shrink: false, rotate: true, gap, angles: [0, 90] });
  const items = [];
  for (const pl of r.placed) {
    if (pl.fail) continue;
    const it = pl.it, f = pl.m; // fabric (u,v) = f·(x,y); print: X = v, Y = −u
    const m = [f[1], -f[0], f[3], -f[2], f[5], -f[4]];
    items.push({ src: it, set: it.set, p: it.p, co: it.poly, m, ox: 0, oy: 0, world: it.poly.map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]) });
  }
  const all = items.flatMap((it) => it.world);
  return { items, bb: bbox(all.length ? all : [[0, 0]]) };
}

// ───────── PDF 1:1, вектор ─────────
// Линии (крой, шов, накладки, надсечки, нить, линейка) — векторные пути: точны при любом увеличении и на плоттере.
// Подписи — однобитные маски 400 dpi (кириллица без встраивания шрифта). Весь чертёж — одна форма (Form XObject),
// каждый лист показывает её участок: файл лёгкий даже на десятки листов А4.
export const PAPER = { A4: { w: 21, h: 29.7, name: 'А4', row: 114 }, A0: { w: 84.1, h: 118.9, name: 'А0', row: 82 } };

const n2 = (v) => (Math.round(v * 1000) / 1000).toString();
async function deflateU8(u8) {
  if (typeof CompressionStream === 'undefined') return null;
  const cs = new CompressionStream('deflate');
  return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(cs)).arrayBuffer());
}
// RunLengthDecode (стандартный фильтр PDF): синхронно и быстро — для сотен мелких масок подписей
// (CompressionStream на каждую мелочь проходит через очередь задач браузера и растягивается на минуты)
function rle(u8) {
  const out = [];
  let i = 0;
  while (i < u8.length) {
    let j = i + 1;
    while (j < u8.length && j - i < 128 && u8[j] === u8[i]) j++;
    if (j - i >= 2) { out.push(257 - (j - i), u8[i]); i = j; continue; }
    j = i + 1;
    while (j < u8.length && j - i < 128 && !(j + 1 < u8.length && u8[j] === u8[j + 1])) j++;
    out.push(j - i - 1); for (let k = i; k < j; k++) out.push(u8[k]);
    i = j;
  }
  out.push(128);
  return Uint8Array.from(out);
}
// подпись → однобитная маска (1 — краска), размеры в см
function labelMask(s, sizePx, weight) {
  const RES = 400 / 2.54, f = (sizePx * 400) / 150; // кегль задан в пикселях при 150 dpi (как в растровой версии)
  const cv = document.createElement('canvas'), c = cv.getContext('2d');
  c.font = `${weight} ${f}px "Inter Tight", Arial, sans-serif`;
  const W = Math.max(2, Math.ceil(c.measureText(s).width) + 4), H = Math.max(2, Math.ceil(f * 1.35));
  cv.width = W; cv.height = H;
  c.font = `${weight} ${f}px "Inter Tight", Arial, sans-serif`; c.fillStyle = '#000'; c.textBaseline = 'middle'; c.fillText(s, 2, H / 2);
  const a = c.getImageData(0, 0, W, H).data, rb = Math.ceil(W / 8), bits = new Uint8Array(rb * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (a[(y * W + x) * 4 + 3] > 110) bits[y * rb + (x >> 3)] |= 0x80 >> (x & 7);
  return { W, H, bits, wcm: W / RES, hcm: H / RES };
}

export async function pdfVector(app, sets, paperKey = 'A4') {
  const P = PAPER[paperKey] || PAPER.A4;
  const mats = app.matsById();
  const PW = P.w, PH = P.h, MG = 1.0, FOOT = 1.4;
  const TW = PW - 2 * MG, TH = PH - 2 * MG - FOOT;
  // А4 — одна общая раскладка, разрезанная на листы для склейки. Крупный лист (А0) — детали раскладываются по листам
  // целиком: что не влезло в высоту листа, переносится на следующий (склейки нет).
  const sheets = [];
  if (paperKey === 'A4') sheets.push(printLayout(sets, P.row));
  else {
    let rest = null;
    for (let guard = 0; guard < 60; guard++) {
      const L = printLayout(sets, TW, 1.5, rest);
      if (!L.items.length) break;
      let take = L.items.filter((it) => bbox(it.world).y0 >= L.bb.y1 - TH - 0.01);
      if (!take.length) take = [L.items[0]]; // деталь выше листа — пусть переходит на соседний
      const lay = { items: take, bb: bbox(take.flatMap((it) => it.world)) };
      sheets.push(lay);
      const used = new Set(take.map((it) => it.src));
      rest = L.items.filter((it) => !used.has(it.src)).map((it) => it.src);
      if (!rest.length) break;
    }
  }
  const tiles = sheets.map((L) => ({ L, cols: Math.max(1, Math.ceil(L.bb.w / TW - 0.001)), rows: Math.max(1, Math.ceil(L.bb.h / TH - 0.001)) }));
  const rows = tiles.reduce((a, t) => a + t.rows, 0), cols = Math.max(...tiles.map((t) => t.cols));
  const enc = new TextEncoder();
  const masks = new Map(); // ключ → { name, m }
  const mask = (s, size, weight) => { const k = s + '|' + size + '|' + weight; if (!masks.has(k)) masks.set(k, { name: 'L' + masks.size, m: labelMask(s, size, weight) }); return masks.get(k); };
  // подпись в текущей системе координат (см, y вверх): align — center | left, по вертикали — по середине
  // flip — деталь на листе повёрнута «вверх ногами»: подпись разворачиваем на 180°, чтобы читалась
  let flip = false;
  const txt = (s, x, y, size, weight = '400', align = 'center') => {
    const t = mask(String(s), size, weight), w = t.m.wcm, h = t.m.hcm, x0 = align === 'center' ? x - w / 2 : x - 0.05, y0 = y - h / 2;
    return flip ? `q ${n2(-w)} 0 0 ${n2(-h)} ${n2(x0 + w)} ${n2(y0 + h)} cm /${t.name} Do Q\n` : `q ${n2(w)} 0 0 ${n2(h)} ${n2(x0)} ${n2(y0)} cm /${t.name} Do Q\n`;
  };
  const path = (pts, close = true) => pts.map((q, i) => `${n2(q[0])} ${n2(q[1])} ${i ? 'l' : 'm'}`).join(' ') + (close ? ' h' : '') + ' S\n';
  // ── форма на каждую раскладку: весь чертёж в мировых см
  const drawForm = (L) => {
    let F = '0 G 0 g 1 J 1 j\n';
    for (const it of L.items) {
      const { p, set } = it, m = it.m;
      flip = m[0] < -0.2; // ось x детали смотрит влево — текст был бы перевёрнут
      F += `q ${m.map(n2).join(' ')} cm\n`;
      F += `0.045 w [] 0 d\n${path(it.co)}`; // линия кроя
      F += `0.018 w [0.16 0.1] 0 d\n${path(p.pts)}`; // линия шва
      for (const o of p.overlays || []) F += `0.015 w [0.08 0.08] 0 d\n${path(o.pts)}`;
      F += '[] 0 d\n';
      for (let k = 0; k < p.corners.length; k++) {
        const cid = p.corners[k].id, sm = seamOf(set.g, p.id, cid);
        if (!sm) continue;
        const e = edgePts(p, k), mi = Math.floor(e.length / 2), q = e[mi];
        const a = e[Math.max(0, mi - 1)], b = e[Math.min(e.length - 1, mi + 1)];
        let nx = b[1] - a[1], ny = -(b[0] - a[0]); const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        const sa = p.meta[cid]?.sa ?? 1;
        F += `0.035 w ${path([q, [q[0] + nx * (sa + 0.05), q[1] + ny * (sa + 0.05)]], false)}`;
        const idx = set.g.seams.indexOf(sm);
        F += txt(String.fromCharCode(65 + (idx % 26)) + (idx >= 26 ? Math.floor(idx / 26) : ''), q[0] - nx * 1.3, q[1] - ny * 1.3, 11, '600');
      }
      const ct = centroid(p.pts), bb = bbox(p.pts), ga = ((p.grain || 0) * Math.PI) / 180, gl = Math.min(bb.h, bb.w) * 0.32;
      const gx = Math.sin(ga) * gl, gy = Math.cos(ga) * gl;
      F += `0.02 w ${path([[ct[0] - gx, ct[1] - gy], [ct[0] + gx, ct[1] + gy]], false)}`;
      for (const sg of [1, -1]) {
        const tx = ct[0] + sg * gx, ty = ct[1] + sg * gy;
        F += path([[tx - sg * Math.sin(ga) * 1.4 + Math.cos(ga) * 0.6, ty - sg * Math.cos(ga) * 1.4 - Math.sin(ga) * 0.6], [tx, ty], [tx - sg * Math.sin(ga) * 1.4 - Math.cos(ga) * 0.6, ty - sg * Math.cos(ga) * 1.4 + Math.sin(ga) * 0.6]], false);
      }
      const mat = mats[p.mat];
      F += txt(p.name, ct[0] + 1.2, ct[1] + 3, 15, '700', 'left');
      F += txt(`${set.g.name} · размер ${set.size}`, ct[0] + 1.2, ct[1] + 1.2, 11, '400', 'left');
      F += txt(`${mat ? mat.name : ''} · крой 1 · нить ${p.grain || 0}°`, ct[0] + 1.2, ct[1] - 0.4, 11, '400', 'left');
      F += 'Q\n';
    }
    flip = false;
    return F;
  };
  const forms = tiles.map((t) => { masks.clear(); const F = drawForm(t.L); return { F, masks: [...masks.values()] }; });
  // ── листы
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const pages = [];
  tiles.forEach((T, si) => {
    const L = T.L;
    for (let r = 0; r < T.rows; r++) for (let q = 0; q < T.cols; q++) {
      const wx0 = L.bb.x0 + q * TW, wy1 = L.bb.y1 - r * TH;
      const used = L.items.some((it) => { const b = bbox(it.world); return b.x1 > wx0 && b.x0 < wx0 + TW && b.y0 < wy1 && b.y1 > wy1 - TH; });
      if (!used) continue;
      masks.clear();
      const single = T.rows === 1 && T.cols === 1;
      const id = paperKey === 'A4' ? letters[r % 26] + (q + 1) : String(si + 1) + (single ? '' : '-' + letters[r % 26] + (q + 1));
      const top = PH - MG, bot = top - TH, fy = MG + FOOT / 2;
      let C = `${n2(72 / 2.54)} 0 0 ${n2(72 / 2.54)} 0 0 cm 0 G 0 g\n`;
      C += `0.6 G 0.02 w [0.15 0.15] 0 d ${n2(MG)} ${n2(bot)} ${n2(TW)} ${n2(TH)} re S [] 0 d 0 G\n`;
      C += '0.03 w\n';
      for (const [cx, cy] of [[MG, top], [MG + TW, top], [MG, bot], [MG + TW, bot]]) C += path([[cx - 0.6, cy], [cx + 0.6, cy]], false) + path([[cx, cy - 0.6], [cx, cy + 0.6]], false);
      C += `q ${n2(MG)} ${n2(bot)} ${n2(TW)} ${n2(TH)} re W n 1 0 0 1 ${n2(MG - wx0)} ${n2(top - wy1)} cm /Fm${si} Do Q\n`;
      const head = paperKey === 'A4' ? `ЛИСТ ${id}  ·  ${T.rows}×${T.cols}` : `ЛИСТ ${id} ИЗ ${tiles.length}  ·  БЕЗ СКЛЕЙКИ`;
      C += txt(`${head}  ·  ${P.name}  ·  МАСШТАБ 1:1`, MG, fy + 0.22, 16, '600', 'left');
      const hint = 'печатать 100%, без «по размеру страницы»';
      if (paperKey === 'A4') C += txt(`↑ ${r > 0 ? letters[(r - 1) % 26] + (q + 1) : '—'}   ← ${q > 0 ? letters[r % 26] + q : '—'}   → ${q < T.cols - 1 ? letters[r % 26] + (q + 2) : '—'}   ↓ ${r < T.rows - 1 ? letters[(r + 1) % 26] + (q + 1) : '—'}   ·   ${hint}`, MG, fy - 0.3, 11, '400', 'left');
      else C += txt(`Деталей на листе: ${L.items.length}   ·   ${hint}   ·   КРОМКА`, MG, fy - 0.3, 11, '400', 'left');
      // контрольная линейка 10 см — вектор: проверка, что печать без масштабирования
      const rx = PW - MG - 10;
      C += `${n2(rx)} ${n2(fy + 0.15)} 10 0.12 re f\n`;
      for (let i = 0; i <= 10; i++) C += `${n2(rx + i - 0.01)} ${n2(fy + 0.15 - (i % 5 ? 0.18 : 0.32))} 0.02 ${n2(i % 5 ? 0.18 : 0.32)} re f\n`;
      C += txt('проверка: 10 см', rx, fy - 0.35, 10, '400', 'left');
      pages.push({ content: C, masks: [...masks.values()] });
    }
  });
  // ── сборка файла
  const objs = []; // [{ head, stream }]
  const add = (o) => { objs.push(o); return objs.length + 2; }; // 1 — каталог, 2 — дерево страниц
  const streamObj = async (dict, u8) => { const z = await deflateU8(u8); return { head: `<< ${dict}${z ? ' /Filter /FlateDecode' : ''} /Length ${(z || u8).length} >>`, stream: z || u8 }; };
  const plainObj = (dict, u8) => ({ head: `<< ${dict} /Length ${u8.length} >>`, stream: u8 });
  const maskObj = (t) => { const z = rle(t.m.bits); return { head: `<< /Type /XObject /Subtype /Image /ImageMask true /Width ${t.m.W} /Height ${t.m.H} /BitsPerComponent 1 /Decode [1 0] /Filter /RunLengthDecode /Length ${z.length} >>`, stream: z }; };
  const maskIds = (list) => list.map((t) => [t.name, add(maskObj(t))]);
  const formIds = [];
  for (let i = 0; i < forms.length; i++) {
    const fm = maskIds(forms[i].masks), fb = tiles[i].L.bb;
    formIds.push(add(await streamObj(`/Type /XObject /Subtype /Form /BBox [${n2(fb.x0 - 5)} ${n2(fb.y0 - 5)} ${n2(fb.x1 + 5)} ${n2(fb.y1 + 5)}] /Resources << /XObject << ${fm.map(([n, j]) => `/${n} ${j} 0 R`).join(' ')} >> >>`, enc.encode(forms[i].F))));
  }
  const ptW = (PW / 2.54) * 72, ptH = (PH / 2.54) * 72;
  const pageIds = [];
  for (const pg of pages) {
    const pm = maskIds(pg.masks);
    const cId = add(plainObj('', enc.encode(pg.content)));
    pageIds.push(add({ head: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(ptW)} ${n2(ptH)}] /Resources << /XObject << ${formIds.map((f, i) => `/Fm${i} ${f} 0 R`).join(' ')} ${pm.map(([n, i]) => `/${n} ${i} 0 R`).join(' ')} >> >> /Contents ${cId} 0 R >>` }));
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
  return { blob: new Blob(chunks, { type: 'application/pdf' }), pages: pages.length, rows, cols, paper: P.name };
}

// ───────── DXF (AAMA-style) ─────────
const uEsc = (s) => [...String(s)].map((ch) => (ch.charCodeAt(0) < 128 ? ch : '\\U+' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'))).join('');
export function dxf(app, sets) {
  const mats = app.matsById();
  const out = [];
  const w = (code, val) => out.push(String(code), String(val));
  w(0, 'SECTION'); w(2, 'HEADER'); w(9, '$ACADVER'); w(1, 'AC1009'); w(9, '$INSBASE'); w(10, 0); w(20, 0); w(30, 0); w(9, '$MEASUREMENT'); w(70, 1); w(9, '$INSUNITS'); w(70, 4); w(0, 'ENDSEC');
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
