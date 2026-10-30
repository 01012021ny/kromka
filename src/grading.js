// Size grading: regenerate the base block for neighbouring sizes, build a displacement field
// per generated piece and apply it to the user's edited pieces (cuts, bends, overlays keep their design intent).
import { GENERATORS, edgePts, nEdges } from './patterns.js';
import { pointAt, deep } from './util.js';

export const SIZES = ['3XS', '2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
// increments per size step, cm (близко к межразмерным приростам ГОСТ/ISO для женской и мужской групп)
export const DEFAULT_STEP = { chest: 4, underbust: 4, waist: 4, hips: 4, neck: 1, shoulder: 1.2, upperArm: 1.2, wrist: 0.4, thigh: 2.4, knee: 1.2, calf: 1.4, ankle: 0.6, armLen: 0.5, height: 0 };
export const STEP_LABELS = { chest: 'Грудь', waist: 'Талия', hips: 'Бёдра', shoulder: 'Плечи', neck: 'Шея', upperArm: 'Плечо (обхват)', thigh: 'Бедро', armLen: 'Длина руки', height: 'Рост' };

export function defaultGrading(base = 'M') {
  return { base, sizes: ['XS', 'S', 'M', 'L', 'XL'], step: { ...DEFAULT_STEP }, qty: { [base]: 1 }, show: true };
}

export function gradeMeasures(M, k, step) {
  const m = deep(M);
  for (const key in step) if (key !== 'height' && typeof m[key] === 'number') m[key] = M[key] + step[key] * k;
  if (step.height) {
    const H = M.height + step.height * k, f = H / M.height;
    m.height = H;
    for (const key in m.y) m.y[key] = M.y[key] * f;
    m.armLen = (M.armLen + step.armLen * k) * f; m.inseam = M.inseam * f;
  }
  return m;
}

const cache = new Map();
function generated(g, M) {
  const key = g.gen + JSON.stringify(g.params) + JSON.stringify(M);
  if (cache.has(key)) return cache.get(key);
  const out = GENERATORS[g.gen](M, g.params);
  const map = {};
  for (const p of out.pieces) map[p.name] = p;
  if (cache.size > 60) cache.clear();
  cache.set(key, map);
  return map;
}

function fieldFor(p0, p1) {
  // boundary correspondences by corner structure + arc fraction
  const S = [], D = [];
  const n = Math.min(nEdges(p0), nEdges(p1));
  for (let k = 0; k < n; k++) {
    const e0 = edgePts(p0, k), e1 = edgePts(p1, k);
    for (let i = 0; i < 24; i++) {
      const t = i / 24;
      const a = pointAt(e0, t).pt, b = pointAt(e1, t).pt;
      S.push(a); D.push([b[0] - a[0], b[1] - a[1]]);
    }
  }
  return (x, y) => {
    let sw = 0, dx = 0, dy = 0;
    for (let i = 0; i < S.length; i++) {
      const ex = x - S[i][0], ey = y - S[i][1];
      const d2 = ex * ex + ey * ey;
      if (d2 < 1e-6) return D[i];
      const w = 1 / (d2 * d2);
      sw += w; dx += w * D[i][0]; dy += w * D[i][1];
    }
    return [dx / sw, dy / sw];
  };
}

export function baseNameOf(piece, names) {
  if (piece.base && names.includes(piece.base)) return piece.base;
  let best = null;
  for (const n of names) if (piece.name.startsWith(n) && (!best || n.length > best.length)) best = n;
  return best;
}

// returns deep-copied pieces graded to `size` (same ids, suffix-free)
export function gradeGarment(g, M, size) {
  const gr = g.grading || defaultGrading();
  const k = SIZES.indexOf(size) - SIZES.indexOf(gr.base);
  if (!k || !GENERATORS[g.gen]) return g.pieces.map((p) => deep(p));
  const A = generated(g, M), B = generated(g, gradeMeasures(M, k, gr.step));
  const names = Object.keys(A);
  const fields = {};
  return g.pieces.map((p) => {
    const c = deep(p);
    const bn = baseNameOf(p, names);
    if (!bn || !B[bn]) return c;
    const F = (fields[bn] ||= fieldFor(A[bn], B[bn]));
    const mir = p.baseMirror ? -1 : 1;
    const mv = (x, y) => { const d = F(x * mir, y); return [x + d[0] * mir, y + d[1]]; };
    c.pts = p.pts.map(([x, y]) => mv(x, y));
    for (const o of c.overlays || []) o.pts = o.pts.map(([x, y]) => mv(x, y));
    for (const r of c.prints || []) { const q = mv(r.x, r.y); r.x = q[0]; r.y = q[1]; }
    for (const h of c.hardware || []) { const q = mv(h.x, h.y); h.x = q[0]; h.y = q[1]; }
    for (const s of c.strokes || []) s.pts = s.pts.map(([x, y]) => mv(x, y));
    return c;
  });
}

export function sizesOf(g) {
  const gr = g.grading || defaultGrading();
  return SIZES.filter((s) => gr.sizes.includes(s) || s === gr.base);
}
