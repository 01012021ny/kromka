// @ts-check
// ───────── geometry / misc helpers (2D pattern space in cm) ─────────
let _uid = 1;
export const uid = (p = 'id') => p + (_uid++).toString(36) + Math.random().toString(36).slice(2, 5);
export const setUidBase = (n) => { _uid = Math.max(_uid, n); };
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const deep = (o) => JSON.parse(JSON.stringify(o));

export function cubic(p0, p1, p2, p3, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}
export function line(a, b, n) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push([lerp(a[0], b[0], i / n), lerp(a[1], b[1], i / n)]);
  return out;
}
export function polyLen(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}
// resample open polyline into n segments (n+1 pts) by arc length
export function resample(pts, n) {
  const L = polyLen(pts);
  if (L < 1e-9 || pts.length < 2) return Array.from({ length: n + 1 }, () => [...pts[0]]);
  const out = [[...pts[0]]];
  let seg = 1, acc = 0, segLen = dist(pts[0], pts[1]);
  for (let i = 1; i < n; i++) {
    const target = (L * i) / n;
    while (acc + segLen < target && seg < pts.length - 1) { acc += segLen; seg++; segLen = dist(pts[seg - 1], pts[seg]); }
    const t = segLen > 1e-12 ? (target - acc) / segLen : 0;
    out.push([lerp(pts[seg - 1][0], pts[seg][0], t), lerp(pts[seg - 1][1], pts[seg][1], t)]);
  }
  out.push([...pts[pts.length - 1]]);
  return out;
}
// point at arc-length fraction t on polyline; returns {pt, seg, t}
export function pointAt(pts, frac) {
  const L = polyLen(pts), target = L * frac;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (acc + d >= target || i === pts.length - 1) {
      const t = d > 1e-12 ? clamp((target - acc) / d, 0, 1) : 0;
      return { pt: [lerp(pts[i - 1][0], pts[i][0], t), lerp(pts[i - 1][1], pts[i][1], t)], seg: i - 1, t };
    }
    acc += d;
  }
  return { pt: [...pts[pts.length - 1]], seg: pts.length - 2, t: 1 };
}
export function area(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return a / 2;
}
export function centroid(poly) {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    cx += (poly[j][0] + poly[i][0]) * f; cy += (poly[j][1] + poly[i][1]) * f; a += f;
  }
  if (Math.abs(a) < 1e-9) return [poly[0][0], poly[0][1]];
  return [cx / (3 * a), cy / (3 * a)];
}
export function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1]; }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}
export function inside(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
export function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return { d: Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy), t };
}
export function polyDist(p, poly, closed = true) {
  let best = Infinity, seg = -1, tt = 0;
  const n = poly.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const r = segDist(p, poly[i], poly[(i + 1) % n]);
    if (r.d < best) { best = r.d; seg = i; tt = r.t; }
  }
  return { d: best, seg, t: tt };
}
// segment intersection: returns {t,u,pt} or null
export function segX(a, b, c, d) {
  const r0 = b[0] - a[0], r1 = b[1] - a[1], s0 = d[0] - c[0], s1 = d[1] - c[1];
  const den = r0 * s1 - r1 * s0;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s1 - (c[1] - a[1]) * s0) / den;
  const u = ((c[0] - a[0]) * r1 - (c[1] - a[1]) * r0) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, pt: [a[0] + t * r0, a[1] + t * r1] };
}
// Ramer–Douglas–Peucker
export function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let idx = -1, md = 0;
  const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) { const d = segDist(pts[i], a, b).d; if (d > md) { md = d; idx = i; } }
  if (md > eps) return simplify(pts.slice(0, idx + 1), eps).slice(0, -1).concat(simplify(pts.slice(idx), eps));
  return [a, b];
}
// Catmull–Rom through control points → dense polyline
export function catmull(ctrl, perSeg = 8, closed = false) {
  if (ctrl.length < 3) return ctrl.map((p) => [...p]);
  const out = [], n = ctrl.length;
  const P = (i) => (closed ? ctrl[(i + n) % n] : ctrl[clamp(i, 0, n - 1)]);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  if (!closed) out.push([...ctrl[n - 1]]);
  return out;
}
export const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);
export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
// seeded rng
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
export function hexToRgb(h) {
  const v = parseInt(h.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0')).join('');
}
export function shade(hex, k) {
  const [r, g, b] = hexToRgb(hex);
  return k >= 0 ? rgbToHex(r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k) : rgbToHex(r * (1 + k), g * (1 + k), b * (1 + k));
}
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
