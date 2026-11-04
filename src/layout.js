// @ts-check
// Marker making: raster bottom-left nesting on a fabric roll, utilisation, offcuts and what they can become
import { cutOutline, pieceArea, overlayPiece } from './patterns.js';
import { area, bbox, clamp } from './util.js';
import { CONS } from './materials.js';

const HIDES = { lamb06: 7, goat08: 6, horse12: 22, cow14: 45, crack: 8, suede09: 8 };

// pattern (x across, y = warp) → fabric (u along roll, v across width); a pure rotation (no mirroring — face side stays up)
function affine(grainDeg, rot180, sx, sy) {
  const g = (-(grainDeg || 0) * Math.PI) / 180, c = Math.cos(g), s = Math.sin(g), k = rot180 ? -1 : 1;
  // X' = X c − Y s ; Y' = X s + Y c ; u = Y' ; v = −X'
  return [k * s * sx, -k * c * sx, k * c * sy, k * s * sy, 0, 0]; // [a,b,c,d,e,f]: u = a x + c y, v = b x + d y
}
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function transform(poly, grainDeg, rot180, sx, sy) {
  const m = affine(grainDeg, rot180, sx, sy);
  const pts = poly.map(([x, y]) => apply(m, x, y));
  const b = bbox(pts);
  m[4] = -b.x0; m[5] = -b.y0;
  const out = pts.map(([u, v]) => [u - b.x0, v - b.y0]);
  out.m = m;
  return out;
}

function raster(pts, cs, gap) {
  const b = bbox(pts);
  const nu = Math.ceil((b.w + gap * 2) / cs) + 1, nv = Math.ceil((b.h + gap * 2) / cs) + 1;
  const spans = Array.from({ length: nv }, () => [Infinity, -Infinity]);
  const n = pts.length;
  const mark = (v, u0, u1) => { if (v < 0 || v >= nv) return; spans[v][0] = Math.min(spans[v][0], u0); spans[v][1] = Math.max(spans[v][1], u1); };
  for (let j = 0; j < nv; j++) {
    for (const f of [0.02, 0.5, 0.98]) {
      const V = (j + f) * cs - gap;
      const xs = [];
      for (let i = 0; i < n; i++) {
        const a = pts[i], c = pts[(i + 1) % n];
        if ((a[1] > V) !== (c[1] > V)) xs.push(a[0] + ((V - a[1]) * (c[0] - a[0])) / (c[1] - a[1]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) mark(j, Math.floor((xs[k] + gap) / cs - gap / cs), Math.ceil((xs[k + 1] + gap) / cs + gap / cs));
    }
  }
  // edges crossing cells
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[(i + 1) % n];
    const steps = Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / (cs * 0.5)) + 1;
    for (let t = 0; t <= steps; t++) {
      const u = a[0] + ((c[0] - a[0]) * t) / steps, v = a[1] + ((c[1] - a[1]) * t) / steps;
      const j = Math.floor((v + gap) / cs), uu = Math.floor((u + gap) / cs);
      mark(j, uu - 1, uu + 2);
    }
  }
  const rows = spans.map(([a, b]) => (a <= b ? [Math.max(0, a), Math.min(nu, b)] : null));
  return { nu, nv, rows };
}

export function nestMaterial(items, mat, opt = {}) {
  // try a few orderings, keep the shortest marker
  let best = null;
  const orders = [
    (a, b) => Math.abs(area(b.poly)) - Math.abs(area(a.poly)),
    (a, b) => bbox(b.poly).h - bbox(a.poly).h,
    (a, b) => bbox(b.poly).w - bbox(a.poly).w,
  ];
  const runs = orders.map((o) => items.slice().sort(o));
  if (items.length <= 14) {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 8; k++) { const arr = items.slice().sort(orders[0]); for (let i = arr.length - 1; i > 0; i--) { if (rnd() < 0.5) { const j = Math.max(0, i - 1 - Math.floor(rnd() * 3)); [arr[i], arr[j]] = [arr[j], arr[i]]; } } runs.push(arr); }
  }
  for (const ordered of runs) {
    const r = nestOnce(ordered, mat, opt);
    if (!best || r.length < best.length - 0.5 || (Math.abs(r.length - best.length) <= 0.5 && r.offcuts.length && best.offcuts.length && r.offcuts[0].area > best.offcuts[0].area)) best = r;
  }
  return best;
}
function nestOnce(items, mat, opt = {}) {
  const cs = opt.cell || 1;
  const W = mat.width || 150;
  const isHide = !!CONS[mat.cons]?.hide;
  const comp = opt.shrink !== false && mat.shrink ? [1 / (1 - (mat.shrink[1] || 0) / 100), 1 / (1 - (mat.shrink[0] || 0) / 100)] : [1, 1];
  const nv = Math.floor(W / cs);
  const Lmax = 4000;
  const occ = new Uint8Array(nv * Lmax);
  const placed = [];
  const order = items;
  let used = 0, totalArea = 0;
  const gap = opt.gap ?? 0.3;
  for (const it of order) {
    let best = null;
    for (const [extra, rot] of (opt.angles || [0]).flatMap((a) => (opt.rotate === false ? [[a, false]] : [[a, false], [a, true]]))) {
      const pts = transform(it.poly, (it.grain || 0) + extra, rot, comp[0], comp[1]);
      const R = raster(pts, cs, gap);
      if (R.nv > nv) continue;
      const fits = (u0, v0) => {
        for (let j = 0; j < R.nv; j++) {
          const r = R.rows[j]; if (!r) continue;
          const base = (v0 + j) * Lmax + u0;
          for (let u = r[0]; u < r[1]; u++) if (occ[base + u]) return false;
        }
        return true;
      };
      let found = null;
      outer: for (let u0 = 0; u0 + R.nu < Lmax; u0++) {
        if (best && u0 + R.nu >= best.u0 + best.R.nu) break;
        for (let v0 = 0; v0 + R.nv <= nv; v0++) if (fits(u0, v0)) { found = { u0, v0 }; break outer; }
      }
      if (found && (!best || found.u0 + R.nu < best.u0 + best.R.nu)) best = { ...found, R, pts, rot };
    }
    if (!best) { placed.push({ it, fail: true }); continue; }
    const { R, u0, v0 } = best;
    for (let j = 0; j < R.nv; j++) { const r = R.rows[j]; if (!r) continue; const base = (v0 + j) * Lmax + u0; for (let u = r[0]; u < r[1]; u++) occ[base + u] = 1; }
    const pts = best.pts.map(([u, v]) => [u + u0 * cs, v + v0 * cs]);
    const m = best.pts.m.slice(); m[4] += u0 * cs; m[5] += v0 * cs;
    placed.push({ it, pts, rot: best.rot, u0: u0 * cs, v0: v0 * cs, m });
    used = Math.max(used, (u0 + R.nu) * cs);
    totalArea += Math.abs(area(pts));
  }
  const length = Math.ceil(used);
  const util = length > 0 ? totalArea / (length * W) : 0;
  // offcuts: connected free regions inside [0,length]
  const L = Math.ceil(length / cs);
  const seen = new Uint8Array(nv * L);
  const offcuts = [];
  for (let v = 0; v < nv; v++) for (let u = 0; u < L; u++) {
    const id = v * L + u;
    if (seen[id] || occ[v * Lmax + u]) continue;
    const stack = [id]; seen[id] = 1; const cells = [];
    while (stack.length) {
      const c = stack.pop(); cells.push(c);
      const cu = c % L, cv = (c / L) | 0;
      for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nu = cu + du, nvv = cv + dv;
        if (nu < 0 || nvv < 0 || nu >= L || nvv >= nv) continue;
        const ni = nvv * L + nu;
        if (seen[ni] || occ[nvv * Lmax + nu]) continue;
        seen[ni] = 1; stack.push(ni);
      }
    }
    if (cells.length * cs * cs < 30) continue;
    const rect = maxRect(cells, L, cs);
    offcuts.push({ area: cells.length * cs * cs, rect, cells: cells.length > 4000 ? null : cells, L });
  }
  offcuts.sort((a, b) => b.area - a.area);
  for (const o of offcuts) o.ideas = ideasFor(o.rect, mat);
  const wasteArea = Math.max(0, length * W - totalArea);
  const res = {
    mat, W, length, util, placed, offcuts, cs, totalArea, wasteArea,
    wasteGrams: (wasteArea / 1e4) * mat.gsm, usedGrams: (totalArea / 1e4) * mat.gsm,
    comp, isHide,
  };
  if (isHide) {
    const ft2 = totalArea / 929.03;
    const hide = HIDES[mat.presetId] || 8;
    res.ft2 = ft2; res.hides = Math.ceil((ft2 / 0.78) / hide); res.hideFt2 = hide;
    res.cost = ft2 / 0.78 * (mat.price || 0);
  } else res.cost = (length / 100) * (mat.price || 0);
  return res;
}

function maxRect(cells, L, cs) {
  // largest axis-aligned rectangle of free cells (histogram method)
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const c of cells) { const u = c % L, v = (c / L) | 0; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const w = u1 - u0 + 1, h = v1 - v0 + 1;
  if (w * h > 400000) return { u: u0 * cs, v: v0 * cs, w: w * cs, h: h * cs };
  const g = new Uint8Array(w * h);
  for (const c of cells) { const u = c % L, v = (c / L) | 0; g[(v - v0) * w + (u - u0)] = 1; }
  const hist = new Int32Array(w);
  let best = { a: 0 };
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) hist[i] = g[j * w + i] ? hist[i] + 1 : 0;
    const st = [];
    for (let i = 0; i <= w; i++) {
      const hh = i < w ? hist[i] : 0;
      let start = i;
      while (st.length && st[st.length - 1][1] >= hh) {
        const [si, sh] = st.pop();
        const a = sh * (i - si);
        if (a > best.a) best = { a, u: si, v: j - sh + 1, w: i - si, h: sh };
        start = si;
      }
      st.push([start, hh]);
    }
  }
  if (!best.a) return { u: u0 * cs, v: v0 * cs, w: cs, h: cs };
  return { u: (best.u + u0) * cs, v: (best.v + v0) * cs, w: best.w * cs, h: best.h * cs };
}

function ideasFor(r, mat) {
  const a = Math.max(r.w, r.h), b = Math.min(r.w, r.h);
  const out = [];
  if (b >= 30 && a >= 35) out.push('вставка / капюшон / подкладка кармана-кенгуру');
  if (b >= 16 && a >= 18) out.push(`накладной карман ${Math.round(Math.min(b, 22))}×${Math.round(Math.min(a, 24))} см`);
  if (b >= 6 && a >= 40) out.push(`обтачка / планка ${Math.round(b)}×${Math.round(a)} см`);
  if (b >= 3.5 && a >= 20) {
    const strips = Math.floor(b / 3.5), len = Math.round((strips * a) / 100 * 100) / 100;
    out.push(`бейка ${strips}×${Math.round(a)} см (≈${len} м${CONS[mat.cons]?.knit ? ', поперёк петельных столбиков' : ', лучше по косой'})`);
  }
  if (b >= 8 && a >= 8 && out.length < 2) out.push('аппликация / пэчворк / шлёвки / петли для вешалки');
  if (!out.length) out.push('лоскут: пробы строчки, этикетка, шлёвка');
  return out;
}

export function collectItems(garments, mats, expand) {
  const byMat = {};
  for (const g of garments) {
    if (g.visible === false) continue;
    const sets = expand ? expand(g) : [{ size: null, pieces: g.pieces, qty: 1 }];
    for (const set of sets) for (let q = 0; q < (set.qty ?? 1); q++) {
      const sfx = (set.size ? ' · ' + set.size : '') + ((set.qty ?? 1) > 1 ? ' #' + (q + 1) : '');
      for (const p of set.pieces) {
        if (p.hidden) continue;
        (byMat[p.mat] ||= []).push({ id: p.id + sfx, name: p.name + sfx, garment: g.name, poly: cutOutline(p), grain: p.grain || 0, area: pieceArea(p) });
        for (const o of p.overlays || []) {
          if (o.hidden) continue;
          const poly = cutOutline(overlayPiece(o, p));
          (byMat[o.mat || p.mat] ||= []).push({ id: o.id + sfx, name: (o.name || 'Накладка') + ' (' + p.name + ')' + sfx, garment: g.name, poly, grain: p.grain || 0, area: Math.abs(area(o.pts)) });
        }
      }
    }
  }
  return Object.entries(byMat).map(([mid, items]) => ({ mat: mats[mid], items })).filter((x) => x.mat);
}

export function nestAll(garments, mats, opt, expand) {
  return collectItems(garments, mats, expand).map(({ mat, items }) => nestMaterial(items, mat, opt));
}
export { clamp };
