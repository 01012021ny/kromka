// @ts-check
// Импорт лекал из файлов в детали КРОМКИ.
//  • SVG — FreeSewing, Inkscape, Illustrator (единицы из width/height + viewBox);
//  • DXF — AAMA/ASTM из CLO, Gerber, Optitex и наш экспорт (блоки + INSERT, слой 1 — контур, 14 — линия шва);
//  • PDF — векторные лекала; лучше версия A0 «копицентр» (деталь целиком на листе). A4 со склейкой не собирается.
// Итог — замкнутые контуры деталей в сантиметрах (y вверх). Если внутри контура реза найдена линия шва той же формы,
// деталь берётся по линии шва, а припуск — по расстоянию между ними; иначе контур — линия реза, припуск 0.
import { area, bbox, inside, polyLen, simplify } from './util.js';

/** см в одной единице файла */
export const UNITS = { mm: 0.1, cm: 1, in: 2.54, pt: 2.54 / 72, px: 2.54 / 96 };
export const UNIT_NAMES = { mm: 'миллиметры', cm: 'сантиметры', in: 'дюймы', pt: 'пункты PDF', px: 'пиксели (96 dpi)' };

/** @typedef {{pts:number[][], closed:boolean, layer?:string}} Path */

// ───────── общее: аффинные матрицы [a b c d e f] — x' = a·x + c·y + e, y' = b·x + d·y + f
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const ID = [1, 0, 0, 1, 0, 0];

/** кубическая Безье → точки (без начальной) */
function cubic(out, p0, p1, p2, p3, n = 12) {
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
  }
}
function quad(out, p0, p1, p2, n = 10) {
  for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]); }
}
/** дуга эллипса SVG (конечные точки) → точки */
function svgArc(out, p0, rx, ry, phi, large, sweep, p1) {
  if (!rx || !ry) { out.push(p1); return; }
  rx = Math.abs(rx); ry = Math.abs(ry);
  const c = Math.cos(phi), s = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
  const x1 = c * dx + s * dy, y1 = -s * dx + c * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1, den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / (den || 1)));
  const cx1 = (k * rx * y1) / ry, cy1 = (-k * ry * x1) / rx;
  const cx = c * cx1 - s * cy1 + (p0[0] + p1[0]) / 2, cy = s * cx1 + c * cy1 + (p0[1] + p1[1]) / 2;
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI / 16)));
  for (let i = 1; i <= n; i++) { const t = t1 + (dt * i) / n; out.push([cx + rx * Math.cos(t) * c - ry * Math.sin(t) * s, cy + rx * Math.cos(t) * s + ry * Math.sin(t) * c]); }
}

// ───────── SVG ─────────
const LEN_UNIT = { mm: 'mm', cm: 'cm', in: 'in', pt: 'pt', px: 'px', '': 'px' };
function svgLen(v) { const m = /^\s*([-\d.eE+]+)\s*([a-z%]*)/.exec(v || ''); return m ? { v: +m[1], u: LEN_UNIT[m[2]] || null } : null; }
function svgTransform(s) {
  let m = ID;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g; let t;
  while ((t = re.exec(s || ''))) {
    const a = t[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let n = ID;
    if (t[1] === 'matrix') n = /** @type {any} */ (a.slice(0, 6));
    else if (t[1] === 'translate') n = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (t[1] === 'scale') n = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
    else if (t[1] === 'rotate') { const r = ((a[0] || 0) * Math.PI) / 180, c = Math.cos(r), si = Math.sin(r); n = [c, si, -si, c, 0, 0]; if (a.length >= 3) n = mul(mul([1, 0, 0, 1, a[1], a[2]], n), [1, 0, 0, 1, -a[1], -a[2]]); }
    else if (t[1] === 'skewX') n = [1, 0, Math.tan((a[0] * Math.PI) / 180), 1, 0, 0];
    else if (t[1] === 'skewY') n = [1, Math.tan((a[0] * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, n);
  }
  return m;
}
const attrs = (s) => { const o = {}; const re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g; let m; while ((m = re.exec(s))) o[m[1]] = m[3] ?? m[4]; return o; };
/** path d → подпути {pts, closed} */
export function svgPathD(d) {
  const toks = (d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || []);
  const out = []; let i = 0, cmd = '', cur = [0, 0], start = [0, 0], pts = null, lastC = null, lastQ = null;
  const num = () => +toks[i++];
  const flush = (closed) => { if (pts && pts.length > 1) out.push({ pts, closed }); pts = null; };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const pt = () => { const x = num(), y = num(); return rel ? [cur[0] + x, cur[1] + y] : [x, y]; };
    if (C === 'Z') { if (pts) { flush(true); } cur = start; lastC = lastQ = null; continue; }
    if (C === 'M') { flush(false); cur = pt(); start = cur; pts = [cur]; cmd = rel ? 'l' : 'L'; lastC = lastQ = null; continue; }
    if (!pts) pts = [cur];
    if (C === 'L') { cur = pt(); pts.push(cur); lastC = lastQ = null; }
    else if (C === 'H') { const x = num(); cur = [rel ? cur[0] + x : x, cur[1]]; pts.push(cur); lastC = lastQ = null; }
    else if (C === 'V') { const y = num(); cur = [cur[0], rel ? cur[1] + y : y]; pts.push(cur); lastC = lastQ = null; }
    else if (C === 'C') { const a = pt(), b = pt(), e = pt(); cubic(pts, cur, a, b, e); lastC = b; lastQ = null; cur = e; }
    else if (C === 'S') { const a = lastC ? [2 * cur[0] - lastC[0], 2 * cur[1] - lastC[1]] : cur, b = pt(), e = pt(); cubic(pts, cur, a, b, e); lastC = b; lastQ = null; cur = e; }
    else if (C === 'Q') { const a = pt(), e = pt(); quad(pts, cur, a, e); lastQ = a; lastC = null; cur = e; }
    else if (C === 'T') { const a = lastQ ? [2 * cur[0] - lastQ[0], 2 * cur[1] - lastQ[1]] : cur, e = pt(); quad(pts, cur, a, e); lastQ = a; lastC = null; cur = e; }
    else if (C === 'A') { const rx = num(), ry = num(), ph = (num() * Math.PI) / 180, la = num(), sw = num(), e = pt(); svgArc(pts, cur, rx, ry, ph, la, sw, e); cur = e; lastC = lastQ = null; }
    else i++; // неизвестная команда — пропустить число
  }
  flush(false);
  return out;
}
/** @returns {{paths: Path[], unit: string|null}} координаты — в единицах файла, y вверх */
export function parseSVG(text) {
  const SKIP = new Set(['defs', 'symbol', 'clipPath', 'mask', 'text', 'pattern', 'marker', 'title', 'desc', 'metadata', 'style', 'script']);
  const paths = []; const stack = [ID]; let skip = 0, root = null;
  const re = /<!--[\s\S]*?-->|<\s*(\/?)\s*([a-zA-Z][\w:-]*)([^>]*?)(\/?)\s*>/g; let m;
  while ((m = re.exec(text))) {
    if (!m[2]) continue;
    const close = !!m[1], tag = m[2].replace(/^.*:/, ''), self = !!m[4] || /\/\s*$/.test(m[3]);
    if (close) { if (SKIP.has(tag)) skip = Math.max(0, skip - 1); else if (tag === 'g' || tag === 'svg' || tag === 'a') stack.pop(); continue; }
    if (SKIP.has(tag)) { if (!self) skip++; continue; }
    if (skip) continue;
    const a = attrs(m[3]);
    let M = mul(stack[stack.length - 1], svgTransform(a.transform));
    if (tag === 'svg' && !root) {
      root = a;
      const vb = (a.viewBox || '').split(/[\s,]+/).map(Number), w = svgLen(a.width);
      // пользовательская единица → мм (FreeSewing: width в mm и viewBox в mm)
      if (vb.length === 4 && w && w.u && vb[2] > 0) { const k = (w.v * UNITS[w.u]) / vb[2] / UNITS.mm; M = mul(M, [k, 0, 0, k, -vb[0] * k, -vb[1] * k]); root.mm = true; }
      else if (w && w.u && w.u !== 'px') { root.mm = true; M = mul(M, [UNITS.px / UNITS.mm, 0, 0, UNITS.px / UNITS.mm, 0, 0]); }
    }
    if (tag === 'g' || tag === 'svg' || tag === 'a') { if (!self) stack.push(M); continue; }
    let sub = [];
    if (tag === 'path') sub = svgPathD(a.d || '');
    else if (tag === 'polyline' || tag === 'polygon') { const n = (a.points || '').split(/[\s,]+/).filter(Boolean).map(Number), q = []; for (let k = 0; k + 1 < n.length; k += 2) q.push([n[k], n[k + 1]]); if (q.length > 1) sub = [{ pts: q, closed: tag === 'polygon' }]; }
    else if (tag === 'line') sub = [{ pts: [[+a.x1 || 0, +a.y1 || 0], [+a.x2 || 0, +a.y2 || 0]], closed: false }];
    else if (tag === 'rect') { const x = +a.x || 0, y = +a.y || 0, w = +a.width || 0, h = +a.height || 0; if (w && h) sub = [{ pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true }]; }
    else if (tag === 'circle' || tag === 'ellipse') { const cx = +a.cx || 0, cy = +a.cy || 0, rx = +(a.rx ?? a.r) || 0, ry = +(a.ry ?? a.r) || 0; if (rx && ry) { const q = []; for (let k = 0; k < 48; k++) q.push([cx + rx * Math.cos((k / 48) * 2 * Math.PI), cy + ry * Math.sin((k / 48) * 2 * Math.PI)]); sub = [{ pts: q, closed: true }]; } }
    for (const s of sub) paths.push({ pts: s.pts.map(([x, y]) => { const q = ap(M, x, y); return [q[0], -q[1]]; }), closed: s.closed }); // SVG: y вниз → вверх
  }
  return { paths, unit: root?.mm ? 'mm' : null };
}

// ───────── DXF ─────────
/** @returns {{paths: Path[], unit: string|null}} */
export function parseDXF(text) {
  const L = text.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < L.length; i += 2) pairs.push([+L[i].trim(), L[i + 1].trim()]);
  let unit = null, i = 0;
  const blocks = {}, top = [];
  const units = { 1: 'in', 4: 'mm', 5: 'cm', 6: 'cm100' };
  // разбор сущностей подряд; POLYLINE собирает свои VERTEX до SEQEND
  const readEntities = (until) => {
    const ents = [];
    while (i < pairs.length && !(pairs[i][0] === 0 && until.includes(pairs[i][1]))) {
      if (pairs[i][0] !== 0) { i++; continue; }
      const type = pairs[i][1]; i++;
      const e = { type, g: [] };
      while (i < pairs.length && pairs[i][0] !== 0) { e.g.push(pairs[i]); i++; }
      if (type === 'POLYLINE') {
        e.verts = [];
        while (i < pairs.length && pairs[i][1] === 'VERTEX' && pairs[i][0] === 0) { i++; const v = []; while (i < pairs.length && pairs[i][0] !== 0) { v.push(pairs[i]); i++; } e.verts.push(v); }
        if (i < pairs.length && pairs[i][1] === 'SEQEND') { i++; while (i < pairs.length && pairs[i][0] !== 0) i++; }
      }
      ents.push(e);
    }
    return ents;
  };
  while (i < pairs.length) {
    const [c, v] = pairs[i];
    if (c === 9 && v === '$INSUNITS') { const u = pairs[i + 1]; if (u && u[0] === 70) unit = units[+u[1]] || null; i += 2; continue; }
    if (c === 0 && v === 'BLOCK') {
      i++; const head = []; while (i < pairs.length && pairs[i][0] !== 0) { head.push(pairs[i]); i++; }
      const name = (head.find((p) => p[0] === 2) || [0, ''])[1];
      const bx = +(head.find((p) => p[0] === 10)?.[1] || 0), by = +(head.find((p) => p[0] === 20)?.[1] || 0);
      blocks[name] = { ents: readEntities(['ENDBLK']), base: [bx, by] };
      continue;
    }
    if (c === 2 && v === 'ENTITIES') { i++; top.push(...readEntities(['ENDSEC'])); continue; }
    i++;
  }
  const get = (g, code, d = 0) => { const p = g.find((q) => q[0] === code); return p ? +p[1] : d; };
  const all = (g, code) => g.filter((q) => q[0] === code).map((q) => +q[1]);
  const paths = [];
  const bulgePts = (vs, closed) => { // вершины с «выпуклостью» (дуги в полилинии): θ = 4·atan(b), центр слева от хорды при b > 0
    const out = [];
    for (let k = 0; k < vs.length; k++) {
      const a = vs[k], b = vs[(k + 1) % vs.length];
      out.push([a[0], a[1]]);
      if ((k === vs.length - 1 && !closed) || !a[2]) continue;
      const th = 4 * Math.atan(a[2]), dx = b[0] - a[0], dy = b[1] - a[1], ch = Math.hypot(dx, dy);
      if (ch < 1e-9) continue;
      const r = ch / (2 * Math.sin(th / 2)), h = r * Math.cos(th / 2);
      const cx = (a[0] + b[0]) / 2 - (dy / ch) * h, cy = (a[1] + b[1]) / 2 + (dx / ch) * h;
      const a0 = Math.atan2(a[1] - cy, a[0] - cx), n = Math.max(2, Math.ceil(Math.abs(th) / (Math.PI / 16)));
      for (let s = 1; s < n; s++) { const t = a0 + (th * s) / n; out.push([cx + Math.abs(r) * Math.cos(t), cy + Math.abs(r) * Math.sin(t)]); }
    }
    return out;
  };
  const emit = (ents, M, depth) => {
    for (const e of ents) {
      const layer = (e.g.find((q) => q[0] === 8) || [0, ''])[1];
      const push = (pts, closed) => { if (pts.length > 1) paths.push({ pts: pts.map(([x, y]) => ap(M, x, y)), closed, layer }); };
      if (e.type === 'LWPOLYLINE') {
        const xs = all(e.g, 10), ys = all(e.g, 20), vs = [];
        // выпуклость (42) идёт после своей вершины
        let k = -1; for (const [code, val] of e.g) { if (code === 10) { k++; vs[k] = [+val, 0, 0]; } else if (code === 20 && vs[k]) vs[k][1] = +val; else if (code === 42 && vs[k]) vs[k][2] = +val; }
        const closed = (get(e.g, 70) & 1) === 1;
        push(vs.length ? bulgePts(vs, closed) : xs.map((x, j) => [x, ys[j]]), closed);
      } else if (e.type === 'POLYLINE') {
        const vs = (e.verts || []).map((v) => [get(v, 10), get(v, 20), get(v, 42)]);
        const closed = (get(e.g, 70) & 1) === 1;
        push(bulgePts(vs, closed), closed);
      } else if (e.type === 'LINE') push([[get(e.g, 10), get(e.g, 20)], [get(e.g, 11), get(e.g, 21)]], false);
      else if (e.type === 'ARC' || e.type === 'CIRCLE') {
        const cx = get(e.g, 10), cy = get(e.g, 20), r = get(e.g, 40);
        let a0 = e.type === 'ARC' ? (get(e.g, 50) * Math.PI) / 180 : 0, a1 = e.type === 'ARC' ? (get(e.g, 51) * Math.PI) / 180 : 2 * Math.PI;
        if (a1 <= a0) a1 += 2 * Math.PI;
        const n = Math.max(4, Math.ceil((a1 - a0) / (Math.PI / 24))), q = [];
        for (let s = 0; s <= n; s++) { const t = a0 + ((a1 - a0) * s) / n; q.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
        push(q, e.type === 'CIRCLE');
      } else if (e.type === 'SPLINE') {
        const fx = all(e.g, 11), fy = all(e.g, 21), cx = all(e.g, 10), cy = all(e.g, 20);
        const q = fx.length > 1 ? fx.map((x, j) => [x, fy[j]]) : cx.map((x, j) => [x, cy[j]]);
        push(q, (get(e.g, 70) & 1) === 1);
      } else if (e.type === 'INSERT' && depth < 8) {
        const b = blocks[(e.g.find((q) => q[0] === 2) || [0, ''])[1]];
        if (!b) continue;
        const r = (get(e.g, 50) * Math.PI) / 180, sx = get(e.g, 41, 1), sy = get(e.g, 42, 1);
        const T = mul(mul(M, [1, 0, 0, 1, get(e.g, 10), get(e.g, 20)]), mul([Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0], [sx, 0, 0, sy, -b.base[0] * sx, -b.base[1] * sy]));
        emit(b.ents, T, depth + 1);
      }
    }
  };
  emit(top, ID, 0);
  // AAMA/ASTM: если есть слой «1» — контуры только с него (+ «14» — линии шва для припуска)
  const hasAama = paths.some((p) => p.layer === '1');
  const out = hasAama ? paths.filter((p) => p.layer === '1' || p.layer === '14') : paths;
  return { paths: out, unit: unit === 'cm100' ? null : unit };
}

// ───────── PDF ─────────
const latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + 0x8000))); return s; };
async function inflate(u8) {
  // zlib (FlateDecode): в браузере и в Node 18+ есть DecompressionStream
  const ds = new DecompressionStream('deflate');
  const buf = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}
/** мини-разбор объектов PDF: числа, имена, строки, массивы, словари, ссылки */
function pdfValue(s, pos) {
  const ws = () => { while (pos < s.length) { const c = s[pos]; if (c === '%') { while (pos < s.length && s[pos] !== '\n' && s[pos] !== '\r') pos++; } else if (' \t\r\n\f\0'.includes(c)) pos++; else break; } };
  const val = () => {
    ws();
    const c = s[pos];
    if (c === '<' && s[pos + 1] === '<') {
      pos += 2; const o = {};
      for (;;) { ws(); if (s[pos] === '>' && s[pos + 1] === '>') { pos += 2; return o; } const k = val(); const v = val(); if (typeof k === 'object' && k && 'n' in k) o[k.n] = v; else if (pos >= s.length) return o; }
    }
    if (c === '[') { pos++; const a = []; for (;;) { ws(); if (s[pos] === ']') { pos++; return a; } if (pos >= s.length) return a; a.push(val()); } }
    if (c === '/') { pos++; let n = ''; while (pos < s.length && !' \t\r\n\f/[]<>()%{}'.includes(s[pos])) n += s[pos++]; return { n }; }
    if (c === '(') { let d = 0; const st = pos; do { if (s[pos] === '\\') pos++; else if (s[pos] === '(') d++; else if (s[pos] === ')') d--; pos++; } while (d > 0 && pos < s.length); return { str: s.slice(st, pos) }; }
    if (c === '<') { const e = s.indexOf('>', pos); const h = s.slice(pos + 1, e); pos = e + 1; return { hex: h }; }
    const m = /^[-+]?(\d+\.?\d*|\.\d+)/.exec(s.slice(pos, pos + 32));
    if (m) {
      pos += m[0].length;
      const r = /^\s+(\d+)\s+R\b/.exec(s.slice(pos, pos + 24));
      if (r && /^\d+$/.test(m[0])) { pos += r[0].length; return { ref: +m[0] }; }
      return +m[0];
    }
    let w = ''; while (pos < s.length && !' \t\r\n\f/[]<>()%'.includes(s[pos])) w += s[pos++];
    return w === 'true' ? true : w === 'false' ? false : w === 'null' ? null : { kw: w };
  };
  const v = val();
  return { v, pos };
}
/**
 * @param {Uint8Array} u8
 * @returns {Promise<{paths: Path[], unit: string, pages: {w:number,h:number}[], note: string[]}>}
 */
export async function parsePDF(u8) {
  const s = latin1(u8), objs = new Map(), note = [];
  const re = /(\d+)\s+(\d+)\s+obj\b/g; let m;
  while ((m = re.exec(s))) {
    const num = +m[1], st = m.index + m[0].length;
    const { v, pos } = /** @type {{v:any, pos:number}} */ (pdfValue(s, st));
    let stream = null;
    const after = /^\s*stream\r?\n/.exec(s.slice(pos, pos + 16));
    if (after && v && typeof v === 'object') {
      const b0 = pos + after[0].length;
      let len = typeof v.Length === 'number' ? v.Length : -1;
      if (len < 0 || s.slice(b0 + len, b0 + len + 30).indexOf('endstream') < 0) len = s.indexOf('endstream', b0) - b0;
      stream = u8.subarray(b0, b0 + len);
      re.lastIndex = b0 + len;
    }
    objs.set(num, { v, stream });
  }
  const get = (x) => (x && typeof x === 'object' && 'ref' in x ? objs.get(x.ref)?.v : x);
  const filters = (d) => [].concat(get(d.Filter) || []).map((f) => f.n);
  const decode = async (o) => {
    let data = o.stream;
    for (const f of filters(o.v)) {
      if (f === 'FlateDecode') data = await inflate(data);
      else return null; // DCT и пр. — картинки, нам не нужны
    }
    const dp = get(o.v.DecodeParms);
    if (dp && (dp.Predictor || 1) >= 10) { // PNG-предиктор (бывает у потоков объектов)
      const cols = (dp.Columns || 1) + 1, rows = data.length / cols, out = new Uint8Array(rows * (cols - 1)); let prev = new Uint8Array(cols - 1);
      for (let r = 0; r < rows; r++) { const t = data[r * cols], row = data.subarray(r * cols + 1, (r + 1) * cols), cur = new Uint8Array(cols - 1); for (let k = 0; k < cols - 1; k++) cur[k] = (row[k] + (t === 2 ? prev[k] : 0)) & 255; out.set(cur, r * (cols - 1)); prev = cur; }
      data = out;
    }
    return data;
  };
  // потоки объектов (PDF 1.5+): объекты внутри сжатого потока
  for (const [, o] of [...objs]) {
    if (o.stream && o.v?.Type?.n === 'ObjStm') {
      const d = await decode(o); if (!d) continue;
      const t = latin1(d), first = o.v.First, hdr = t.slice(0, first).trim().split(/\s+/).map(Number);
      for (let k = 0; k + 1 < hdr.length; k += 2) if (!objs.has(hdr[k])) objs.set(hdr[k], { v: pdfValue(t, first + hdr[k + 1]).v, stream: null });
    }
  }
  const inherit = (d, key) => { let x = d; for (let g = 0; x && g < 20; g++) { if (x[key] !== undefined) return get(x[key]); x = get(x.Parent); } return undefined; };
  const pages = [...objs.values()].filter((o) => o.v?.Type?.n === 'Page');
  const paths = [], pageBoxes = [];
  // одна и та же форма (XObject) на разных листах — это «окна» в общую раскладку для склейки А4: берём её один раз —
  // так детали из листов со склейкой получаются целыми
  const formPage = new Map();
  let xoff = 0, pageNo = 0;
  for (const pg of pages) {
    pageNo++;
    const d = pg.v, mb = (inherit(d, 'MediaBox') || [0, 0, 612, 792]).map((x) => get(x));
    pageBoxes.push({ w: mb[2] - mb[0], h: mb[3] - mb[1] });
    const contents = [].concat(get(d.Contents) === undefined ? [] : (Array.isArray(get(d.Contents)) ? get(d.Contents) : [d.Contents]));
    let text = '';
    for (const c of contents) { const o = c && c.ref ? objs.get(c.ref) : null; if (o?.stream) { const dd = await decode(o); if (dd) text += latin1(dd) + '\n'; } }
    const pagePaths = [];
    await runContent(text, inherit(d, 'Resources') || {}, [1, 0, 0, 1, xoff - mb[0], -mb[1]], pagePaths, 0);
    paths.push(...pagePaths);
    xoff += mb[2] - mb[0] + 40; // листы — рядом, чтобы детали разных листов не накладывались
  }
  async function runContent(t, res, CTM, out, depth) {
    const toks = tokenize(t);
    const st = []; let ctm = CTM, sub = [], curP = null, path = [], ops = [];
    const flushSub = (closed) => { if (curP && curP.length > 1) path.push({ pts: curP, closed }); curP = null; };
    for (const tk of toks) {
      if (tk.op === undefined) { ops.push(tk.v); continue; }
      const o = tk.op, a = ops; ops = [];
      const P = (x, y) => ap(ctm, x, y);
      switch (o) {
        case 'q': st.push(ctm); break;
        case 'Q': ctm = st.pop() || CTM; break;
        case 'cm': ctm = mul(ctm, /** @type {any} */ (a.slice(0, 6))); break;
        case 'm': flushSub(false); curP = [P(a[0], a[1])]; break;
        case 'l': if (curP) curP.push(P(a[0], a[1])); break;
        case 'c': if (curP) { const p0 = curP[curP.length - 1]; cubic(curP, p0, P(a[0], a[1]), P(a[2], a[3]), P(a[4], a[5])); } break;
        case 'v': if (curP) { const p0 = curP[curP.length - 1]; cubic(curP, p0, p0, P(a[0], a[1]), P(a[2], a[3])); } break;
        case 'y': if (curP) { const p0 = curP[curP.length - 1], e = P(a[2], a[3]); cubic(curP, p0, P(a[0], a[1]), e, e); } break;
        case 'h': flushSub(true); break;
        case 're': flushSub(false); { const [x, y, w, h] = a; path.push({ pts: [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)], closed: true }); } break;
        case 'S': case 's': case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*':
          flushSub(o === 's' || o === 'b' || o === 'b*'); out.push(...path); path = []; break;
        case 'n': flushSub(false); path = []; break; // контур обрезки — не рисуется
        case 'Do': {
          if (depth > 6) break;
          const xd = get(res.XObject) || {}, r = a[0] && xd[a[0].n], xo = r && r.ref ? objs.get(r.ref) : null;
          if (xo && depth === 0) { const seen = formPage.get(r.ref); if (seen != null && seen !== pageNo) break; formPage.set(r.ref, pageNo); }
          if (xo?.v?.Subtype?.n === 'Form' && xo.stream) {
            const dd = await decode(xo); if (!dd) break;
            const M = xo.v.Matrix ? xo.v.Matrix.map((x) => get(x)) : ID;
            await runContent(latin1(dd), get(xo.v.Resources) || res, mul(ctm, M), out, depth + 1);
          }
          break;
        }
        default: break;
      }
    }
    void sub;
  }
  if (!pages.length) note.push('В PDF не найдено страниц');
  return { paths, unit: 'pt', pages: pageBoxes, note };
}
/** токены содержимого страницы: числа/имена/массивы → операнды, слова → операторы; строки, словари и встроенные картинки пропускаются */
function tokenize(t) {
  const out = []; let i = 0;
  while (i < t.length) {
    const c = t[i];
    if (' \t\r\n\f\0'.includes(c)) { i++; continue; }
    if (c === '%') { while (i < t.length && t[i] !== '\n' && t[i] !== '\r') i++; continue; }
    if (c === '(') { let d = 0; do { if (t[i] === '\\') i++; else if (t[i] === '(') d++; else if (t[i] === ')') d--; i++; } while (d > 0 && i < t.length); out.push({ v: null }); continue; }
    if (c === '<' && t[i + 1] === '<') { let d = 0; do { if (t[i] === '<' && t[i + 1] === '<') { d++; i += 2; } else if (t[i] === '>' && t[i + 1] === '>') { d--; i += 2; } else i++; } while (d > 0 && i < t.length); out.push({ v: null }); continue; }
    if (c === '<') { const e = t.indexOf('>', i); i = e < 0 ? t.length : e + 1; out.push({ v: null }); continue; }
    if (c === '[') { const e = t.indexOf(']', i); i = e < 0 ? t.length : e + 1; out.push({ v: null }); continue; }
    if (c === '/') { let n = ''; i++; while (i < t.length && !' \t\r\n\f/[]<>()%'.includes(t[i])) n += t[i++]; out.push({ v: { n } }); continue; }
    if (/[-+.\d]/.test(c)) { let n = ''; while (i < t.length && /[-+.\deE]/.test(t[i])) n += t[i++]; out.push({ v: +n }); continue; }
    let w = ''; while (i < t.length && !' \t\r\n\f/[]<>()%'.includes(t[i])) w += t[i++];
    if (!w) { i++; continue; }
    if (w === 'BI') { const e = t.indexOf('EI', t.indexOf('ID', i)); i = e < 0 ? t.length : e + 2; continue; } // встроенная картинка
    out.push({ op: w });
  }
  return out;
}

// ───────── контуры деталей ─────────
/** соединить открытые линии в замкнутые контуры (лекала из CAD часто рисуются отрезками) */
export function findLoops(paths, tol = 0.05) {
  const loops = [], open = [];
  for (const p of paths) {
    if (p.pts.length < 2) continue;
    const a = p.pts[0], b = p.pts[p.pts.length - 1];
    if (p.closed || (p.pts.length > 2 && Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol)) loops.push({ pts: p.pts, layer: p.layer });
    else open.push(p);
  }
  // сетка концов для поиска продолжения
  const key = (q) => Math.round(q[0] / tol) + ',' + Math.round(q[1] / tol);
  const ends = new Map();
  const add = (q, id, end) => { for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) { const k = (Math.round(q[0] / tol) + dx) + ',' + (Math.round(q[1] / tol) + dy); (ends.get(k) || ends.set(k, []).get(k)).push([id, end]); } };
  open.forEach((p, id) => { add(p.pts[0], id, 0); add(p.pts[p.pts.length - 1], id, 1); });
  const used = new Uint8Array(open.length);
  let openLeft = 0; // отрезки, так и не замкнувшиеся в контур
  const dirAt = (pts, atEnd) => { const n = pts.length, a = atEnd ? pts[n - 2] : pts[1], b = atEnd ? pts[n - 1] : pts[0]; const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
  for (let s0 = 0; s0 < open.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    let chain = open[s0].pts.slice(), closed = false, parts = 1;
    for (let guard = 0; guard < 5000; guard++) {
      const end = chain[chain.length - 1];
      if (chain.length > 2 && Math.hypot(end[0] - chain[0][0], end[1] - chain[0][1]) <= tol) { closed = true; break; }
      const cand = (ends.get(key(end)) || []).filter(([id]) => !used[id]);
      if (!cand.length) break;
      // продолжение — самое прямое (засечки и линии нити подходят к контуру под углом)
      const d0 = dirAt(chain, true);
      let best = null, bs = -2;
      for (const [id, e] of cand) {
        const q = open[id].pts, st = e === 0 ? q[0] : q[q.length - 1];
        if (Math.hypot(st[0] - end[0], st[1] - end[1]) > tol * 1.5) continue;
        const nx = e === 0 ? q[1] : q[q.length - 2], dx = nx[0] - st[0], dy = nx[1] - st[1], l = Math.hypot(dx, dy) || 1;
        const sc = (dx / l) * d0[0] + (dy / l) * d0[1];
        if (sc > bs) { bs = sc; best = [id, e]; }
      }
      if (!best) break;
      used[best[0]] = 1; parts++;
      const q = open[best[0]].pts, add2 = best[1] === 0 ? q : q.slice().reverse();
      for (let t = 1; t < add2.length; t++) chain.push(add2[t]);
    }
    if (closed) loops.push({ pts: chain.slice(0, -1), layer: open[s0].layer });
    else openLeft += parts;
  }
  return { loops, openLeft };
}

const isRect = (pts) => { const b = bbox(pts); return Math.abs(Math.abs(area(pts)) - b.w * b.h) < 0.02 * b.w * b.h; };
/**
 * Контуры (уже в см) → детали. Вложенный контур той же формы (линия шва) задаёт припуск.
 * @returns {{outline:number[][], sa:number, cut:number[][], test:boolean, w:number, h:number, area:number}[]}
 */
export function piecesFromLoops(loops, pages = []) {
  const L = loops.map((l) => { const pts = simplify(l.pts, 0.02); return { pts, a: Math.abs(area(pts)), b: bbox(pts), layer: l.layer }; })
    .filter((l) => l.a >= 20 && Math.min(l.b.w, l.b.h) >= 2 && l.pts.length >= 3);
  // рамки листов: прямоугольник, внутри которого другие контуры, или размером с лист
  const pageCm = pages.map((p) => [p.w * UNITS.pt, p.h * UNITS.pt]);
  const contains = (o, i) => o !== i && o.a > i.a && inside(i.pts[0], o.pts) && inside(i.pts[Math.floor(i.pts.length / 2)], o.pts);
  // рамки листа и поля печати: прямоугольник не меньше 3/4 листа (в любой ориентации) или с другими контурами внутри
  const pageLike = (o) => pageCm.some(([w, h]) => (o.b.w >= 0.75 * w && o.b.h >= 0.75 * h && o.b.w <= w + 1 && o.b.h <= h + 1) || (o.b.w >= 0.75 * h && o.b.h >= 0.75 * w && o.b.w <= h + 1 && o.b.h <= w + 1));
  const frames = new Set(L.filter((o) => isRect(o.pts) && (pageLike(o) || L.filter((i) => contains(o, i)).length >= 2)));
  const C = L.filter((l) => !frames.has(l));
  // AAMA: слой 14 — линия шва, она всегда внутренняя
  const tops = C.filter((l) => l.layer !== '14' && !C.some((o) => o.layer !== '14' && contains(o, l)));
  // одна и та же линия, нарисованная дважды (обводка + заливка) — оставить одну
  const uniq = [];
  for (const t of tops) if (!uniq.some((u) => Math.abs(u.a - t.a) < 0.5 && Math.hypot(u.b.x0 - t.b.x0, u.b.y0 - t.b.y0) < 0.3)) uniq.push(t);
  return uniq.map((o) => {
    const kids = C.filter((i) => contains(o, i) && i.a > o.a * 0.6);
    let outline = o.pts, sa = 0;
    if (kids.length) {
      const k = kids.reduce((a, b) => (b.a > a.a ? b : a));
      const per = polyLen([...k.pts, k.pts[0]]), d = (o.a - k.a) / per; // средний отступ между линиями
      if (d >= 0.3 && d <= 3.2) { outline = k.pts; sa = Math.round(d * 10) / 10; }
    }
    const b = bbox(outline), sq = isRect(outline) && b.w <= 10.6 && Math.abs(b.w - b.h) < 0.25;
    return { outline, sa, cut: o.pts, test: sq, w: b.w, h: b.h, area: Math.abs(area(outline)) };
  }).sort((a, b) => b.area - a.area);
}

function distToPoly(q, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2));
    best = Math.min(best, Math.hypot(q[0] - a[0] - dx * t, q[1] - a[1] - dy * t));
  }
  return best;
}
/** углы контура: поворот > 32° — граница сторон (не меньше 3 сторон); cut — линия реза: припуск каждой стороны по расстоянию до неё */
export function edgesFromOutline(pts, sa = 0, cut = null) {
  let P = simplify(pts, 0.03);
  if (area(P) < 0) P = P.slice().reverse();
  const n = P.length, turn = [];
  for (let i = 0; i < n; i++) {
    // направление сравниваем по отрезкам ~1 см до и после вершины (кривые из мелких отрезков не дают ложных углов)
    const back = walk(P, i, -1, 1.0), fwd = walk(P, i, 1, 1.0);
    const a1 = Math.atan2(P[i][1] - back[1], P[i][0] - back[0]), a2 = Math.atan2(fwd[1] - P[i][1], fwd[0] - P[i][0]);
    let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    turn.push(Math.abs(d));
  }
  let cs = [];
  // угол — поворот > 32°, самый острый среди вершин в пределах 1 см (скруглённый угол из мелких отрезков — один угол)
  for (let i = 0; i < n; i++) {
    if (turn[i] <= (32 * Math.PI) / 180) continue;
    let ok = true;
    for (const dir of [-1, 1]) {
      let acc = 0, k = i;
      for (let s = 0; s < n - 1 && ok; s++) {
        const j = (k + dir + n) % n; acc += Math.hypot(P[j][0] - P[k][0], P[j][1] - P[k][1]);
        if (acc > 1.0) break;
        if (turn[j] > turn[i] || (turn[j] === turn[i] && j < i)) ok = false;
        k = j;
      }
    }
    if (ok) cs.push(i);
  }
  // слишком близкие углы (< 1,5 см) — оставить острейший
  cs = cs.filter((i, k) => { const j = cs[(k + 1) % cs.length]; if (cs.length < 2 || j === i) return true; const L = arcLen(P, i, j); return L >= 1.5 || turn[i] >= turn[j]; });
  while (cs.length < 3) { // гладкий контур (круг, овал) — делим на равные части
    const step = Math.floor(n / 4) || 1; cs = []; for (let i = 0; i < n && cs.length < 4; i += step) cs.push(i);
  }
  cs.sort((a, b) => a - b);
  const edges = [];
  for (let k = 0; k < cs.length; k++) {
    const i = cs[k], j = cs[(k + 1) % cs.length], e = [];
    for (let t = i; ; t = (t + 1) % n) { e.push(P[t]); if (t === j) break; }
    let esa = sa;
    if (cut && sa > 0 && e.length > 1) { // медиана расстояний от внутренних точек стороны до линии реза
      const ds = []; const L = polyLen(e);
      for (let q = 1; q < 8; q++) { const t = q / 8; let acc = 0; for (let u = 1; u < e.length; u++) { const sl = Math.hypot(e[u][0] - e[u - 1][0], e[u][1] - e[u - 1][1]); if (acc + sl >= t * L) { const f = (t * L - acc) / (sl || 1); ds.push(distToPoly([e[u - 1][0] + (e[u][0] - e[u - 1][0]) * f, e[u - 1][1] + (e[u][1] - e[u - 1][1]) * f], cut)); break; } acc += sl; } }
      ds.sort((a, b) => a - b); if (ds.length) esa = Math.round(ds[Math.floor(ds.length / 2)] * 10) / 10;
    }
    edges.push({ pts: e, name: `сторона ${k + 1}`, sa: esa });
  }
  return edges;
}
function walk(P, i, dir, len) { const n = P.length; let acc = 0, k = i; for (let s = 0; s < n - 1; s++) { const j = (k + dir + n) % n; acc += Math.hypot(P[j][0] - P[k][0], P[j][1] - P[k][1]); k = j; if (acc >= len) break; } return P[k]; }
function arcLen(P, i, j) { const n = P.length; let L = 0; for (let t = i; t !== j; t = (t + 1) % n) { const u = (t + 1) % n; L += Math.hypot(P[u][0] - P[t][0], P[u][1] - P[t][1]); } return L; }

/** единица по размеру деталей, если файл её не назвал: самая большая деталь — от 25 до 160 см */
export function guessUnit(paths) {
  let w = 0;
  for (const p of paths) { const b = bbox(p.pts); w = Math.max(w, Math.min(b.w, b.h) > 0 ? Math.max(b.w, b.h) : 0); }
  const order = ['mm', 'cm', 'in', 'pt'];
  let best = 'mm', bd = Infinity;
  for (const u of order) { const s = w * UNITS[u], d = s < 25 ? 25 - s : s > 160 ? s - 160 : 0; if (d < bd) { bd = d; best = u; } }
  return best;
}

/**
 * Разобрать файл лекал.
 * @param {string} name @param {Uint8Array|string} data @param {string|null} [unitOverride]
 */
export async function importPatternFile(name, data, unitOverride = null) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const text = typeof data === 'string' ? data : null;
  let parsed;
  if (ext === 'svg') parsed = parseSVG(text ?? new TextDecoder().decode(/** @type {Uint8Array} */ (data)));
  else if (ext === 'dxf') parsed = parseDXF(text ?? latin1(/** @type {Uint8Array} */ (data)));
  else if (ext === 'pdf') parsed = await parsePDF(typeof data === 'string' ? new TextEncoder().encode(data) : data);
  else throw new Error('Поддерживаются PDF, SVG и DXF');
  const unit = unitOverride || parsed.unit || guessUnit(parsed.paths);
  const k = UNITS[unit];
  const paths = parsed.paths.map((p) => ({ ...p, pts: p.pts.map(([x, y]) => [x * k, y * k]) }));
  const { loops, openLeft } = findLoops(paths, 0.08);
  const pieces = piecesFromLoops(loops, parsed.pages || []);
  const warn = [...(parsed.note || [])];
  if (!pieces.length && openLeft > 20) warn.push('Контуры не замыкаются — похоже, лекало разбито на листы A4 со склейкой. Возьмите версию A0 («копицентр»): там каждая деталь целиком на листе.');
  else if (!pieces.length) warn.push('Замкнутых контуров деталей не найдено. Если это скан (картинка), а не вектор — импорт невозможен.');
  if ((parsed.pages || []).length > 1) warn.push(`Листов: ${parsed.pages.length} — детали со всех листов, разложены рядом.`);
  return { pieces, unit, unitFromFile: !!parsed.unit && !unitOverride, warn, openLeft };
}
