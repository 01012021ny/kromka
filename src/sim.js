// @ts-check
// XPBD cloth: pattern pieces → triangle meshes → placed around the body → sewn → draped
import Delaunator from 'delaunator';
import { resample, polyLen, inside, polyDist, bbox, clamp, area } from './util.js';
import { edgeIdx, edgeLen, edgeK } from './patterns.js';
import { physics } from './materials.js';

const G = 981; // cm/s²
// openings that behave like rings (hoop limit): waist, hems, cuffs, necklines, armholes of sleeveless tops
const RING_EDGES = new Set(['пояс', 'низ', 'низ рукава', 'горловина', 'пройма', 'край']);
const K_STRETCH = 0.035, K_BEND = 1.6e-5;

// ───────── triangulation of one piece ─────────
export function meshPiece(piece, counts, h) {
  const nE = piece.corners.length, bnd = [], chains = [];
  const starts = [];
  for (let k = 0; k < nE; k++) {
    const ep = edgeIdx(piece, k).map((i) => piece.pts[i]);
    const key = piece.id + ':' + piece.corners[k].id;
    const n = counts[key] || Math.max(1, Math.round(polyLen(ep) / h));
    const rs = resample(ep, n);
    starts.push(bnd.length);
    for (let j = 0; j < rs.length - 1; j++) bnd.push(rs[j]);
    chains.push(n);
  }
  const edgeChains = {};
  for (let k = 0; k < nE; k++) {
    const arr = [];
    for (let j = 0; j <= chains[k]; j++) arr.push(j < chains[k] ? starts[k] + j : starts[(k + 1) % nE]);
    edgeChains[piece.corners[k].id] = arr;
  }
  const nb = bnd.length;
  const bx = bbox(bnd), pts = bnd.slice();
  const dy = h * 0.866;
  for (let j = 0, y = bx.y0 + dy * 0.5; y < bx.y1; j++, y += dy)
    for (let x = bx.x0 + (j % 2 ? h * 0.5 : 0); x < bx.x1; x += h) {
      const p = [x, y];
      if (!inside(p, bnd)) continue;
      if (polyDist(p, bnd).d < h * 0.55) continue;
      pts.push(p);
    }
  const flat = new Float64Array(pts.length * 2);
  pts.forEach((p, i) => { flat[2 * i] = p[0]; flat[2 * i + 1] = p[1]; });
  const d = new Delaunator(flat);
  const tris = [];
  for (let t = 0; t < d.triangles.length; t += 3) {
    const a = d.triangles[t], b = d.triangles[t + 1], c = d.triangles[t + 2];
    const cx = (pts[a][0] + pts[b][0] + pts[c][0]) / 3, cy = (pts[a][1] + pts[b][1] + pts[c][1]) / 3;
    if (!inside([cx, cy], bnd)) continue;
    const ar = Math.abs((pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[c][0] - pts[a][0]) * (pts[b][1] - pts[a][1])) / 2;
    if (ar < h * h * 0.01) continue;
    // keep CCW
    const s = (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[c][0] - pts[a][0]) * (pts[b][1] - pts[a][1]);
    if (s > 0) tris.push(a, b, c); else tris.push(a, c, b);
  }
  const v2 = new Float32Array(pts.length * 2);
  pts.forEach((p, i) => { v2[2 * i] = p[0]; v2[2 * i + 1] = p[1]; });
  return { v2, tris: new Uint32Array(tris), edgeChains, nb };
}

// ───────── placement (pattern → initial 3D) ─────────
function ellipseTable(A, B) {
  const n = 400, s = new Float32Array(n + 1), th = new Float32Array(n + 1);
  let acc = 0, px = 0, pz = B;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI;
    const x = A * Math.sin(t), z = B * Math.cos(t);
    if (i > 0) acc += Math.hypot(x - px, z - pz);
    s[i] = acc; th[i] = t; px = x; pz = z;
  }
  return (len) => {
    const a = Math.abs(len);
    if (a >= s[n]) return Math.sign(len) * (Math.PI + (a - s[n]) / ((A + B) / 2));
    let lo = 0, hi = n;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] < a) lo = m; else hi = m; }
    const t = (a - s[lo]) / Math.max(1e-6, s[hi] - s[lo]);
    return Math.sign(len) * (th[lo] + (th[hi] - th[lo]) * t);
  };
}
const ePerim = (A, B) => Math.PI * (3 * (A + B) - Math.sqrt((3 * A + B) * (A + 3 * B)));


function rowExtents(pieces) {
  // union of horizontal extents per 1 cm row for a group of pieces sharing a pattern frame
  let y0 = Infinity, y1 = -Infinity;
  for (const p of pieces) { const b = bbox(p.pts); y0 = Math.min(y0, b.y0); y1 = Math.max(y1, b.y1); }
  if (!isFinite(y0)) return null;
  const Y0 = Math.floor(y0), n = Math.ceil(y1) - Y0 + 1;
  const lo = new Float32Array(n).fill(Infinity), hi = new Float32Array(n).fill(-Infinity);
  for (const p of pieces) {
    const pts = p.pts, m = pts.length;
    for (let j = 0; j < n; j++) {
      const y = Y0 + j + 0.001;
      for (let i = 0; i < m; i++) {
        const a = pts[i], c = pts[(i + 1) % m];
        if ((a[1] > y) !== (c[1] > y)) { const x = a[0] + ((y - a[1]) * (c[0] - a[0])) / (c[1] - a[1]); if (x < lo[j]) lo[j] = x; if (x > hi[j]) hi[j] = x; }
      }
    }
  }
  // fill empty rows from neighbours
  for (let j = 0; j < n; j++) if (!isFinite(lo[j])) { let k = 1; while (k < n) { if (j - k >= 0 && isFinite(lo[j - k])) { lo[j] = lo[j - k]; hi[j] = hi[j - k]; break; } if (j + k < n && isFinite(lo[j + k])) { lo[j] = lo[j + k]; hi[j] = hi[j + k]; break; } k++; } }
  return (y) => { const j = Math.max(0, Math.min(n - 1, Math.round(y - Y0))); return [lo[j], hi[j]]; };
}
function limbRadius(joints, y, alongArm) {
  // radius of a limb at a height (legs) or arc position (arms)
  if (!alongArm) {
    for (let i = joints.length - 1; i > 0; i--) { const a = joints[i], b = joints[i - 1]; if (y >= a.p.y && y <= b.p.y) { const t = (y - a.p.y) / (b.p.y - a.p.y); return a.r + (b.r - a.r) * t; } }
    return y > joints[0].p.y ? joints[0].r * 1.15 : joints[joints.length - 1].r;
  }
  return joints[0].r;
}

export function placementCtx(garment, body, vis) {
  const ctx = { layer: garment.layer || 0 };
  const gap = 2.5 + ctx.layer * 1.6;
  const torso = vis.filter((p) => p.place.kind === 'torso');
  if (torso.length) {
    let y0 = Infinity, y1 = -Infinity, wmax = 0;
    for (const p of torso) { const b = bbox(p.pts); y0 = Math.min(y0, b.y0); y1 = Math.max(y1, b.y1); wmax = Math.max(wmax, b.w); }
    let A = 0, B = 0;
    for (let y = Math.max(y0, body.ty0); y <= Math.min(y1, body.m.y.shoulder); y += 1) { const r = body.ring(y); A = Math.max(A, r.a); B = Math.max(B, r.bF, r.bB); }
    if (!A) { const r = body.ring(body.m.y.hip); A = r.a; B = Math.max(r.bF, r.bB); }
    A += gap; B += gap;
    const need = wmax * 1.04;
    const half = ePerim(A, B) / 2;
    if (half < need) { const k = need / half; A *= k; B *= k; }
    ctx.torso = { A, B, map: ellipseTable(A, B) };
  }
  const legs = vis.filter((p) => p.place.kind === 'leg');
  if (legs.length) {
    ctx.legs = {};
    for (const L of ['L', 'R']) {
      const lp = legs.filter((p) => p.place.limb === L);
      const w = lp.reduce((s, p) => s + bbox(p.pts).w, 0);
      const leg = body.legs[L === 'L' ? 0 : 1];
      const R = Math.max(leg.rT * 1.15 + gap, (w / (2 * Math.PI)) * 1.04);
      const top = leg.joints[0].p, bot = leg.joints[leg.joints.length - 1].p;
      const fr = lp.filter((p) => p.place.side !== 'back'), bk = lp.filter((p) => p.place.side === 'back');
      ctx.legs[L] = { R, top, bot, gap, leg, exF: rowExtents(fr), exB: rowExtents(bk.length ? bk : fr) };
    }
  }
  const arms = vis.filter((p) => p.place.kind === 'arm');
  if (arms.length) {
    ctx.arms = {};
    for (const L of ['L', 'R']) {
      const ap = arms.filter((p) => p.place.limb === L);
      const w = ap.reduce((s, p) => Math.max(s, bbox(p.pts).w), 0);
      const arm = body.arms[L === 'L' ? 0 : 1];
      ctx.arms[L] = { R: Math.max(arm.rUA * 1.2 + gap, (w / (2 * Math.PI)) * 1.05), arm, gap, ex: rowExtents(ap) };
    }
  }
  // притачной пояс: кольцо вокруг торса на своей высоте, x = 0 — середина полосы (середина спинки), концы сходятся спереди
  for (const p of vis.filter((q) => q.place.kind === 'band')) {
    const b = bbox(p.pts), r = body.ring((b.y0 + b.y1) / 2);
    let A = r.a + gap, B = Math.max(r.bF, r.bB) + gap;
    const k = b.w / ePerim(A, B);
    A *= k; B *= k;
    (ctx.band ||= {})[p.id] = { A, B, map: ellipseTable(A, B), xc: (b.x0 + b.x1) / 2 };
  }
  ctx.neckR = body.m.neck / (2 * Math.PI) + gap;
  return ctx;
}

export function placePoint(piece, x, y, ctx, body, out) {
  const pl = piece.place;
  if (pl.kind === 'torso' && ctx.torso) {
    const { A, B, map } = ctx.torso;
    const th = map(x);
    const sx = A * Math.sin(th), sz = B * Math.cos(th);
    if (pl.side === 'back') { out[0] = -sx; out[2] = -sz; } else { out[0] = sx; out[2] = sz; }
    out[1] = y;
  } else if (pl.kind === 'leg' && ctx.legs) {
    const L = ctx.legs[pl.limb] || ctx.legs.L;
    const t = clamp((L.top.y - y) / (L.top.y - L.bot.y), -0.5, 1.2);
    const cx = L.top.x + (L.bot.x - L.top.x) * t, cz = L.top.z + (L.bot.z - L.top.z) * t;
    const back = pl.side === 'back';
    const [fa, fb] = L.exF(y), [ba, bb] = L.exB(y);
    const C = Math.max(1, (fb - fa) + (bb - ba));
    const R = Math.max(limbRadius(L.leg.joints, y) * 1.05 + 1.0 + ctx.layer * 0.6, C / (2 * Math.PI));
    const mid = back ? (ba + bb) / 2 : (fa + fb) / 2;
    const th = (x - mid) / R;
    const s = back ? -1 : 1;
    out[0] = cx + s * R * Math.sin(th); out[1] = y; out[2] = cz + s * R * Math.cos(th);
  } else if (pl.kind === 'arm' && ctx.arms) {
    const A = ctx.arms[pl.limb] || ctx.arms.L;
    const a = A.arm;
    const s = -y - 1.0; // along arm from cap top
    const [ea, eb] = A.ex(y);
    let rr = a.joints[0].r;
    for (let j = 0; j < a.joints.length - 1; j++) {
      const s0 = a.joints[j].p.clone().sub(a.J).dot(a.d), s1 = a.joints[j + 1].p.clone().sub(a.J).dot(a.d);
      if (s >= s0 && s <= s1) { rr = a.joints[j].r + (a.joints[j + 1].r - a.joints[j].r) * ((s - s0) / Math.max(1e-6, s1 - s0)); break; }
      if (s > s1) rr = a.joints[j + 1].r;
    }
    const R = Math.max(rr * 1.05 + 0.8 + ctx.layer * 0.6, (eb - ea) / (2 * Math.PI));
    const th = (x - (ea + eb) / 2) / R;
    out[0] = a.J.x + a.d.x * s + R * (Math.cos(th) * a.o.x);
    out[1] = a.J.y + a.d.y * s + R * (Math.cos(th) * a.o.y);
    out[2] = a.J.z + a.d.z * s + R * Math.sin(th);
  } else if (pl.kind === 'band' && ctx.band?.[piece.id]) {
    const { A, B, map, xc } = ctx.band[piece.id];
    const th = map(x - xc);
    out[0] = -A * Math.sin(th); out[1] = y; out[2] = -B * Math.cos(th);
  } else if (pl.kind === 'neck') {
    const w = bbox(piece.pts).w;
    const R = Math.max(ctx.neckR + 3, w / (2 * Math.PI));
    const th = x / R;
    out[0] = R * Math.sin(th); out[1] = y; out[2] = -1.5 + R * Math.cos(th);
  } else {
    out[0] = x; out[1] = y; out[2] = 30;
  }
}

export function seamRev(g, s, body) {
  const vis = g.pieces;
  const ctx = placementCtx(g, body, vis);
  const pa = vis.find((p) => p.id === s.a.p), pb = vis.find((p) => p.id === s.b.p);
  if (!pa || !pb) return false;
  const ea = edgeIdx(pa, edgeK(pa, s.a.e)).map((i) => pa.pts[i]), eb = edgeIdx(pb, edgeK(pb, s.b.e)).map((i) => pb.pts[i]);
  const P = (pc, pt) => { const o = [0, 0, 0]; placePoint(pc, pt[0], pt[1], ctx, body, o); return o; };
  const a0 = P(pa, ea[0]), a1 = P(pa, ea[ea.length - 1]), b0 = P(pb, eb[0]), b1 = P(pb, eb[eb.length - 1]);
  const D = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]);
  return D(a0, b1) + D(a1, b0) < D(a0, b0) + D(a1, b1);
}

// ───────── simulator ─────────
export class Sim {
  // particle buffers, filled by build()
  /** @type {Float32Array} */ x; /** @type {Float32Array} */ v; /** @type {Float32Array} */ w; /** @type {Float32Array} */ mass;
  /** @type {Float32Array} */ thick; /** @type {Float32Array} */ fric; /** @type {Float32Array} */ damp; /** @type {Float32Array} */ nrm; /** @type {Float32Array} */ r2d;
  /** @type {Uint8Array} */ layer; /** @type {Uint8Array} */ onArm; /** @type {Uint8Array} */ bnd; /** @type {Int32Array} */ pidx;
  constructor(body) {
    this.body = body;
    this.N = 0;
    this.pieces = [];
    this.running = true;
    this.t = 0;
    this.substeps = 8;
    this.iters = 2;
    this.belts = [];
    this.grab = null;
    this.energy = 0;
    this.settled = false;
    this.calm = 0;
  }
  build(garments, matsById, h = 2.6, prev = null) {
    const body = this.body;
    const pieces = [];
    let N = 0;
    const st = [], bd = [], sw = [], chainsAll = [];
    const stR = [], stC = [], stM = [], bdR = [], bdC = [];
    for (const g of garments) {
      if (g.visible === false) continue;
      // внутренние детали (мешковина, откосок, шлёвки) кроятся, но не драпируются
      const vis = g.pieces.filter((p) => !p.hidden && !p.inner);
      if (!vis.length) continue;
      const ctx = placementCtx(g, body, vis);
      const counts = {};
      for (const s of g.seams) {
        const pa = vis.find((p) => p.id === s.a.p), pb = vis.find((p) => p.id === s.b.p);
        if (!pa || !pb) continue;
        const ka = edgeK(pa, s.a.e), kb = edgeK(pb, s.b.e);
        if (ka < 0 || kb < 0) continue;
        const n = Math.max(1, Math.round(Math.max(edgeLen(pa, ka), edgeLen(pb, kb)) / h));
        counts[pa.id + ':' + s.a.e] = n; counts[pb.id + ':' + s.b.e] = n;
      }
      const local = {};
      for (const p of vis) {
        const mat = matsById[p.mat] || Object.values(matsById)[0];
        const ph = physics(mat);
        const mesh = meshPiece(p, counts, h);
        const nv = mesh.v2.length / 2;
        const rec = { piece: p, garment: g, mesh, off: N, n: nv, ph, mat, layer: g.layer || 0, idx: pieces.length };
        local[p.id] = rec;
        pieces.push(rec);
        N += nv;
      }
      // sew constraints
      for (const s of g.seams) {
        const A = local[s.a.p], B = local[s.b.p];
        if (!A || !B) continue;
        const ca = A.mesh.edgeChains[s.a.e], cb = B.mesh.edgeChains[s.b.e];
        if (!ca || !cb) continue;
        const rev = s.rev ?? seamRev(g, s, body);
        const m = Math.min(ca.length, cb.length);
        for (let j = 0; j < m; j++) {
          const ia = A.off + ca[j], ib = B.off + cb[rev ? cb.length - 1 - j : j];
          if (ia !== ib) sw.push(ia, ib);
        }
      }
      g._ctx = ctx;
      // boundary chains (edges not sewn) → closed openings (waist, hem, cuffs…) get hoop limits
      const sewnEdge = new Set();
      for (const s of g.seams) if (local[s.a.p] && local[s.b.p]) { sewnEdge.add(s.a.p + ':' + s.a.e); sewnEdge.add(s.b.p + ':' + s.b.e); }
      for (const p of vis) {
        const r = local[p.id];
        const ph = r.ph;
        for (const c of p.corners) {
          if (sewnEdge.has(p.id + ':' + c.id)) continue;
          const ch = r.mesh.edgeChains[c.id];
          if (!ch) continue;
          const gth = p.meta[c.id]?.gather ?? 1;
          let L = 0;
          for (let j = 1; j < ch.length; j++) L += Math.hypot(r.mesh.v2[2 * ch[j]] - r.mesh.v2[2 * ch[j - 1]], r.mesh.v2[2 * ch[j] + 1] - r.mesh.v2[2 * ch[j - 1] + 1]);
          chainsAll.push({ v: ch.map((i) => r.off + i), L: L * gth - (p.meta[c.id]?.lap || 0), lim: clamp(ph.weft * 2.2, 0.02, 0.7), ring: RING_EDGES.has(p.meta[c.id]?.name || '') || gth < 0.999 });
        }
      }
    }
    this.N = N;
    const x = new Float32Array(N * 3), v = new Float32Array(N * 3), w = new Float32Array(N), mass = new Float32Array(N);
    const thick = new Float32Array(N), fric = new Float32Array(N), damp = new Float32Array(N), layer = new Uint8Array(N), onArm = new Uint8Array(N);
    const nrm = new Float32Array(N * 3);
    const pidx = new Int32Array(N), bnd = new Uint8Array(N), r2d = new Float32Array(N * 2);
    // positions: map from previous state when possible
    const tmp = [0, 0, 0];
    let mappedAll = !!prev;
    for (const r of pieces) {
      const { mesh, off, piece, ph } = r;
      const old = prev && (prev[piece.id] || (piece.srcId && prev[piece.srcId]));
      const ctx = r.garment._ctx;
      if (!old) mappedAll = false;
      const loc = old ? locator(old) : null;
      for (let i = 0; i < r.n; i++) {
        const px = mesh.v2[2 * i], py = mesh.v2[2 * i + 1];
        let ok = false;
        if (loc) ok = loc(px, py, tmp);
        if (!ok) placePoint(piece, px, py, ctx, body, tmp);
        x[3 * (off + i)] = tmp[0]; x[3 * (off + i) + 1] = tmp[1]; x[3 * (off + i) + 2] = tmp[2];
        thick[off + i] = ph.thick;
        fric[off + i] = ph.fric;
        damp[off + i] = ph.damp;
        layer[off + i] = r.layer;
        pidx[off + i] = r.idx; bnd[off + i] = i < mesh.nb ? 1 : 0; r2d[2 * (off + i)] = px; r2d[2 * (off + i) + 1] = py;
        onArm[off + i] = piece.place.kind === 'arm' ? 1 : 0;
      }
      // masses
      const t = mesh.tris;
      for (let k = 0; k < t.length; k += 3) {
        const a = t[k], b = t[k + 1], c = t[k + 2];
        const ar = Math.abs((mesh.v2[2 * b] - mesh.v2[2 * a]) * (mesh.v2[2 * c + 1] - mesh.v2[2 * a + 1]) - (mesh.v2[2 * c] - mesh.v2[2 * a]) * (mesh.v2[2 * b + 1] - mesh.v2[2 * a + 1])) / 2;
        const m3 = (ar * ph.gsm) / 1e4 / 3;
        mass[off + a] += m3; mass[off + b] += m3; mass[off + c] += m3;
      }
      // stretch + bend
      const edgeMap = new Map();
      const gatherOf = {};
      for (const cid in mesh.edgeChains) {
        const gth = piece.meta[cid]?.gather ?? 1;
        if (gth < 0.999) { const ch = mesh.edgeChains[cid]; for (let j = 0; j < ch.length - 1; j++) { gatherOf[ch[j] + ',' + ch[j + 1]] = gth; gatherOf[ch[j + 1] + ',' + ch[j]] = gth; } }
      }
      const grain = ((piece.grain || 0) * Math.PI) / 180;
      const gx = Math.sin(grain), gy = Math.cos(grain);
      const addEdge = (a, b, opp) => {
        const key = a < b ? a * 65536 + b : b * 65536 + a;
        const e = edgeMap.get(key);
        if (e) { e.opp.push(opp); return; }
        edgeMap.set(key, { a, b, opp: [opp] });
      };
      for (let k = 0; k < t.length; k += 3) { addEdge(t[k], t[k + 1], t[k + 2]); addEdge(t[k + 1], t[k + 2], t[k]); addEdge(t[k + 2], t[k], t[k + 1]); }
      for (const e of edgeMap.values()) {
        const dx = mesh.v2[2 * e.b] - mesh.v2[2 * e.a], dy = mesh.v2[2 * e.b + 1] - mesh.v2[2 * e.a + 1];
        let L = Math.hypot(dx, dy);
        const gth = gatherOf[e.a + ',' + e.b];
        if (gth) L *= gth;
        const c = Math.abs(dx * gx + dy * gy) / (Math.hypot(dx, dy) || 1); // |cos| to warp
        const s2 = 1 - c * c;
        const biasT = Math.abs(2 * c * Math.sqrt(s2));
        const ext = (ph.warp * c * c + ph.weft * s2) * (1 - biasT) + ph.bias * biasT;
        st.push(off + e.a, off + e.b); stR.push(L); stC.push((ext * K_STRETCH) / ph.gsm); stM.push(L * (1 + clamp(ext * 2.2, 0.025, 0.7)));
        if (e.opp.length === 2) {
          const o1 = e.opp[0], o2 = e.opp[1];
          const bl = Math.hypot(mesh.v2[2 * o1] - mesh.v2[2 * o2], mesh.v2[2 * o1 + 1] - mesh.v2[2 * o2 + 1]);
          bd.push(off + o1, off + o2); bdR.push(bl); bdC.push(K_BEND / Math.max(1e-4, ph.bend));
        }
      }
    }
    for (const r of pieces) {
      let avg = 0; for (let i = r.off; i < r.off + r.n; i++) avg += mass[i]; avg /= Math.max(1, r.n);
      for (let i = r.off; i < r.off + r.n; i++) mass[i] = Math.max(mass[i], avg * 0.45);
    }
    for (let i = 0; i < N; i++) w[i] = mass[i] > 0 ? 1 / mass[i] : 0;
    this.frameX = new Float32Array(x);
    Object.assign(this, { x, v, w, mass, thick, fric, damp, layer, onArm, nrm, pieces, pidx, bnd, r2d });
    this.prevX = new Float32Array(x);
    this.st = new Int32Array(st); this.stR = new Float32Array(stR); this.stC = new Float32Array(stC); this.stM = new Float32Array(stM);
    this.bd = new Int32Array(bd); this.bdR = new Float32Array(bdR); this.bdC = new Float32Array(bdC);
    this.sw = new Int32Array(sw);
    // union-find over sewn vertices
    const par = new Int32Array(N); for (let i = 0; i < N; i++) par[i] = i;
    const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    for (let c = 0; c < sw.length; c += 2) { const a = find(sw[c]), b = find(sw[c + 1]); if (a !== b) par[a] = b; }
    const used = new Array(chainsAll.length).fill(false), loops = [];
    for (let s0 = 0; s0 < chainsAll.length; s0++) {
      if (used[s0]) continue;
      used[s0] = true;
      const verts = chainsAll[s0].v.slice();
      let L = chainsAll[s0].L, lim = chainsAll[s0].lim, closed = false, ring = chainsAll[s0].ring;
      const startC = find(verts[0]);
      for (let guard = 0; guard < 40; guard++) {
        const endC = find(verts[verts.length - 1]);
        if (endC === startC && verts.length > 2) { closed = true; break; }
        let nxt = -1, flip = false;
        for (let j = 0; j < chainsAll.length; j++) {
          if (used[j]) continue;
          const ch = chainsAll[j].v;
          if (find(ch[0]) === endC) { nxt = j; flip = false; break; }
          if (find(ch[ch.length - 1]) === endC) { nxt = j; flip = true; break; }
        }
        if (nxt < 0) break;
        used[nxt] = true;
        const ch = flip ? chainsAll[nxt].v.slice().reverse() : chainsAll[nxt].v;
        verts.push(...ch.slice(1));
        L += chainsAll[nxt].L; lim = Math.min(lim, chainsAll[nxt].lim); ring = ring && chainsAll[nxt].ring;
      }
      if (closed && ring) loops.push({ v: Int32Array.from(verts.slice(0, -1)), rest: L, max: L * (1 + lim), soft: lim > 0.15 ? 0.12 : 0.04 });
    }
    this.loops = loops;
    this.maxLayer = Math.max(0, ...pieces.map((r) => r.layer));
    if (this.selfCollide === undefined) this.selfCollide = true;
    this.t = mappedAll ? 2.2 : 0;
    this.settled = false; this.calm = 0;
    this.running = true;
    this.hashSize = 1 << 15;
    this.cellStart = new Int32Array(this.hashSize + 1);
    this.cellEntries = new Int32Array(N);
    this.outward = new Float32Array(N * 3);
    return this;
  }
  snapshot() {
    const o = {};
    for (const r of this.pieces) {
      o[r.piece.id] = { v2: r.mesh.v2, tris: r.mesh.tris, x: this.x.slice(r.off * 3, (r.off + r.n) * 3) };
    }
    return o;
  }
  wake() { this.settled = false; this.calm = 0; this.running = true; }
  step(dt) {
    if (!this.N || !this.running || this.settled) return;
    dt = Math.min(dt, 1 / 30);
    const sub = this.substeps, h = dt / sub, h2 = h * h;
    const { x, v, w, st, stR, stC, stM, bd, bdR, bdC, sw, prevX, damp } = this;
    const N = this.N, body = this.body;
    const sewPhase = this.t < 1.4;
    const gk = this.t < 0.9 ? 0.12 : this.t < 1.8 ? 0.12 + ((this.t - 0.9) / 0.9) * 0.88 : 1;
    const sewA = sewPhase ? 2e-4 * Math.max(0, 1 - this.t / 1.1) : 0;
    const maxMove = sewPhase ? 0.5 : 2;
    const nrm = [0, 0, 0];
    let ke = 0;
    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < N; i++) {
        const k = 3 * i;
        prevX[k] = x[k]; prevX[k + 1] = x[k + 1]; prevX[k + 2] = x[k + 2];
        if (w[i] === 0) continue;
        const dmp = Math.exp(-(damp[i] + (sewPhase ? 6 : 0.35)) * h);
        v[k] *= dmp; v[k + 1] = (v[k + 1] - G * gk * h) * dmp; v[k + 2] *= dmp;
        x[k] += v[k] * h; x[k + 1] += v[k + 1] * h; x[k + 2] += v[k + 2] * h;
      }
      for (let it = 0; it < this.iters; it++) {
        // stretch
        for (let c = 0, n = stR.length; c < n; c++) {
          const a = st[2 * c], b = st[2 * c + 1];
          const wa = w[a], wb = w[b];
          const ka = 3 * a, kb = 3 * b;
          const dx = x[kb] - x[ka], dy = x[kb + 1] - x[ka + 1], dz = x[kb + 2] - x[ka + 2];
          const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (l < 1e-9) continue;
          let C = l - stR[c];
          if (C < 0) C *= 0.15; // cloth buckles instead of resisting compression
          const al = stC[c] / h2;
          const dl = -C / (wa + wb + al);
          const fx = (dx / l) * dl, fy = (dy / l) * dl, fz = (dz / l) * dl;
          x[ka] -= fx * wa; x[ka + 1] -= fy * wa; x[ka + 2] -= fz * wa;
          x[kb] += fx * wb; x[kb + 1] += fy * wb; x[kb + 2] += fz * wb;
        }
        // strain limiting (keeps woven fabric from behaving like rubber; two passes)
        for (let pass = 0; pass < 1; pass++)
          for (let c = 0, n = stR.length; c < n; c++) {
            const a = st[2 * c], b = st[2 * c + 1];
            const ka = 3 * a, kb = 3 * b;
            const dx = x[kb] - x[ka], dy = x[kb + 1] - x[ka + 1], dz = x[kb + 2] - x[ka + 2];
            const l2 = dx * dx + dy * dy + dz * dz, lm = stM[c];
            if (l2 <= lm * lm) continue;
            const l = Math.sqrt(l2), wa = w[a], wb = w[b], ws = wa + wb;
            if (ws === 0) continue;
            const k = (l - lm) / (l * ws);
            x[ka] += dx * k * wa; x[ka + 1] += dy * k * wa; x[ka + 2] += dz * k * wa;
            x[kb] -= dx * k * wb; x[kb + 1] -= dy * k * wb; x[kb + 2] -= dz * k * wb;
          }
        // hoop limits on closed openings (global, fast-converging)
        for (const lp of this.loops) {
          const vv = lp.v, n = vv.length;
          let L = 0, cx = 0, cy = 0, cz = 0;
          for (let j = 0; j < n; j++) {
            const a = 3 * vv[j], b = 3 * vv[(j + 1) % n];
            L += Math.sqrt((x[b] - x[a]) ** 2 + (x[b + 1] - x[a + 1]) ** 2 + (x[b + 2] - x[a + 2]) ** 2);
            cx += x[a]; cy += x[a + 1]; cz += x[a + 2];
          }
          if (L <= lp.rest || this.t < 1.0) continue;
          cx /= n; cy /= n; cz /= n;
          const tgt = Math.min(lp.max, lp.rest + (L - lp.rest) * (1 - lp.soft));
          const f = tgt / L;
          for (let j = 0; j < n; j++) { const a = 3 * vv[j]; x[a] = cx + (x[a] - cx) * f; x[a + 1] = cy + (x[a + 1] - cy) * f; x[a + 2] = cz + (x[a + 2] - cz) * f; }
        }
        // bend
        for (let c = 0, n = it === 0 ? bdR.length : 0; c < n; c++) {
          const a = bd[2 * c], b = bd[2 * c + 1];
          const wa = w[a], wb = w[b];
          const ka = 3 * a, kb = 3 * b;
          const dx = x[kb] - x[ka], dy = x[kb + 1] - x[ka + 1], dz = x[kb + 2] - x[ka + 2];
          const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (l < 1e-9) continue;
          const C = l - bdR[c];
          if (C > 0) continue; // only resist folding (hinge closing)
          const al = bdC[c] / h2;
          const dl = -C / (wa + wb + al);
          const fx = (dx / l) * dl, fy = (dy / l) * dl, fz = (dz / l) * dl;
          x[ka] -= fx * wa; x[ka + 1] -= fy * wa; x[ka + 2] -= fz * wa;
          x[kb] += fx * wb; x[kb + 1] += fy * wb; x[kb + 2] += fz * wb;
        }
        // sewing
        const alS = sewA / h2;
        for (let c = 0, n = sw.length; c < n; c += 2) {
          const a = sw[c], b = sw[c + 1];
          const wa = w[a], wb = w[b];
          const ka = 3 * a, kb = 3 * b;
          let dx = x[kb] - x[ka], dy = x[kb + 1] - x[ka + 1], dz = x[kb + 2] - x[ka + 2];
          const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (l < 1e-6) continue;
          let k = -l / (wa + wb + alS);
          const lim = maxMove / Math.max(wa, wb);
          if (-k > lim) k = -lim;
          const fx = (dx / l) * k, fy = (dy / l) * k, fz = (dz / l) * k;
          x[ka] -= fx * wa; x[ka + 1] -= fy * wa; x[ka + 2] -= fz * wa;
          x[kb] += fx * wb; x[kb + 1] += fy * wb; x[kb + 2] += fz * wb;
        }
        // grab
        if (this.grab) {
          const g = this.grab, k = 3 * g.i;
          x[k] += (g.p[0] - x[k]) * 0.35; x[k + 1] += (g.p[1] - x[k + 1]) * 0.35; x[k + 2] += (g.p[2] - x[k + 2]) * 0.35;
        }
        // layered cloth repulsion
        if (this.selfCollide && it === 0 && (s & 1) === 0) this.clothCollide();
        // body + belts + floor collisions
        for (let i = 0; i < N; i++) {
          const k = 3 * i;
          const m = this.thick[i] * 0.5 + 0.35 + this.layer[i] * 0.45;
          let d = body.sdf(x[k], x[k + 1], x[k + 2], nrm);
          if (d < m) {
            const push = m - d;
            x[k] += nrm[0] * push; x[k + 1] += nrm[1] * push; x[k + 2] += nrm[2] * push;
            // Coulomb friction (PBD): stick while tangential slip < μs·penetration, otherwise kinetic damping
            const tx = x[k] - prevX[k], ty = x[k + 1] - prevX[k + 1], tz = x[k + 2] - prevX[k + 2];
            const dn = tx * nrm[0] + ty * nrm[1] + tz * nrm[2];
            const sx = tx - dn * nrm[0], sy = ty - dn * nrm[1], sz = tz - dn * nrm[2];
            const sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
            const mu = this.fric[i];
            const f = sl < mu * 1.25 * push ? 1 : Math.min(1, (mu * push) / (sl + 1e-9) + mu * 0.35);
            x[k] -= sx * f; x[k + 1] -= sy * f; x[k + 2] -= sz * f;
            d = body.sdf(x[k], x[k + 1], x[k + 2], nrm);
            if (d < m) { const p2 = m - d; x[k] += nrm[0] * p2; x[k + 1] += nrm[1] * p2; x[k + 2] += nrm[2] * p2; }
          }
          if (x[k + 1] < 0.2) { x[k + 1] = 0.2; x[k] = prevX[k] * 0.8 + x[k] * 0.2; x[k + 2] = prevX[k + 2] * 0.8 + x[k + 2] * 0.2; }
          for (const bt of this.belts) {
            if (Math.abs(x[k + 1] - bt.y) > bt.hw) continue;
            if (this.layer[i] > bt.layer || this.onArm[i]) continue;
            const r = body.ring(bt.y), dz = x[k + 2] - r.zc;
            const b = dz >= 0 ? r.bF : r.bB;
            const ex = r.a + bt.slack + this.layer[i] * 0.45, ez = b + bt.slack + this.layer[i] * 0.45;
            const q = (x[k] / ex) ** 2 + (dz / ez) ** 2;
            if (q > 1 && q < 4.5) { const sc = 1 / Math.sqrt(q); x[k] *= sc; x[k + 2] = r.zc + dz * sc; }
          }
        }
      }
      // velocities
      const vmax = 400;
      for (let i = 0; i < N; i++) {
        const k = 3 * i;
        let vx = (x[k] - prevX[k]) / h, vy = (x[k + 1] - prevX[k + 1]) / h, vz = (x[k + 2] - prevX[k + 2]) / h;
        const sp = vx * vx + vy * vy + vz * vz;
        if (sp > vmax * vmax) { const f = vmax / Math.sqrt(sp); vx *= f; vy *= f; vz *= f; }
        v[k] = vx; v[k + 1] = vy; v[k + 2] = vz;
      }
    }
    const fx = this.frameX;
    for (let i = 0; i < 3 * N; i++) { const d = x[i] - fx[i]; ke += d * d; fx[i] = x[i]; }
    this.t += dt;
    this.energy = Math.sqrt(ke / Math.max(1, N)) / dt;
    if (this.t > 3 && this.energy < 1.2 && !this.grab) { this.calm += dt; if (this.calm > 1.2) this.settled = true; } else this.calm = 0;
  }
  computeNormals() {
    const { x, nrm } = this;
    nrm.fill(0);
    for (const r of this.pieces) {
      const t = r.mesh.tris, o = r.off;
      for (let k = 0; k < t.length; k += 3) {
        const a = 3 * (o + t[k]), b = 3 * (o + t[k + 1]), c = 3 * (o + t[k + 2]);
        const ux = x[b] - x[a], uy = x[b + 1] - x[a + 1], uz = x[b + 2] - x[a + 2];
        const vx = x[c] - x[a], vy = x[c + 1] - x[a + 1], vz = x[c + 2] - x[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const q of [a, b, c]) { nrm[q] += nx; nrm[q + 1] += ny; nrm[q + 2] += nz; }
      }
    }
    for (let i = 0; i < this.N; i++) { const k = 3 * i; const l = Math.hypot(nrm[k], nrm[k + 1], nrm[k + 2]) || 1; nrm[k] /= l; nrm[k + 1] /= l; nrm[k + 2] /= l; }
    // outward orientation for layering
    const o = [0, 0, 0], ow = this.outward;
    for (let i = 0; i < this.N; i++) {
      const k = 3 * i;
      this.body.sdf(x[k], x[k + 1], x[k + 2], o);
      const s = nrm[k] * o[0] + nrm[k + 1] * o[1] + nrm[k + 2] * o[2] >= 0 ? 1 : -1;
      ow[k] = nrm[k] * s; ow[k + 1] = nrm[k + 1] * s; ow[k + 2] = nrm[k + 2] * s;
    }
  }
  // cloth–cloth: one-way normal push for layered garments, symmetric push inside one garment (self-collision)
  clothCollide() {
    const { x, layer, outward, cellStart, cellEntries, hashSize, pidx, bnd, r2d, thick } = this;
    const N = this.N, cs = 2.4, inv = 1 / cs;
    const hash = (ix, iy, iz) => (((ix * 92837111) ^ (iy * 689287499) ^ (iz * 283923481)) >>> 0) & (hashSize - 1);
    cellStart.fill(0);
    for (let i = 0; i < N; i++) { const k = 3 * i; cellStart[hash(Math.floor(x[k] * inv), Math.floor(x[k + 1] * inv), Math.floor(x[k + 2] * inv))]++; }
    let acc = 0;
    for (let i = 0; i < hashSize; i++) { acc += cellStart[i]; cellStart[i] = acc; }
    cellStart[hashSize] = acc;
    for (let i = 0; i < N; i++) { const k = 3 * i; const hh = hash(Math.floor(x[k] * inv), Math.floor(x[k + 1] * inv), Math.floor(x[k + 2] * inv)); cellEntries[--cellStart[hh]] = i; }
    const RL = 2.0, RS = 1.15;
    for (let i = 0; i < N; i++) {
      const k = 3 * i, li = layer[i];
      const fx = x[k] * inv, fy = x[k + 1] * inv, fz = x[k + 2] * inv;
      const ix0 = Math.floor(fx - 0.5), iy0 = Math.floor(fy - 0.5), iz0 = Math.floor(fz - 0.5);
      for (let a = 0; a <= 1; a++) for (let b = 0; b <= 1; b++) for (let c = 0; c <= 1; c++) {
        const hh = hash(ix0 + a, iy0 + b, iz0 + c);
        for (let e = cellStart[hh], end = cellStart[hh + 1]; e < end; e++) {
          const j = cellEntries[e];
          if (j === i) continue;
          const kj = 3 * j;
          const dx = x[k] - x[kj], dy = x[k + 1] - x[kj + 1], dz = x[k + 2] - x[kj + 2];
          const d2 = dx * dx + dy * dy + dz * dz;
          const lj = layer[j];
          if (lj < li) {
            if (d2 > RL * RL) continue;
            const nx = outward[kj], ny = outward[kj + 1], nz = outward[kj + 2];
            const sN = dx * nx + dy * ny + dz * nz;
            const gap = (thick[i] + thick[j]) * 0.5 + 0.25;
            if (sN >= gap) continue;
            if (d2 - sN * sN > 1.8 * 1.8) continue;
            const push = (gap - sN) * 0.5;
            x[k] += nx * push; x[k + 1] += ny * push; x[k + 2] += nz * push;
          } else if (lj === li && j > i) {
            const r = Math.max(RS, (thick[i] + thick[j]) * 0.5 + 0.5);
            if (d2 >= r * r || d2 < 1e-10) continue;
            if (bnd[i] && bnd[j]) continue; // seams & edges: sewn neighbours live here
            if (pidx[i] === pidx[j]) { const ux = r2d[2 * i] - r2d[2 * j], uy = r2d[2 * i + 1] - r2d[2 * j + 1]; if (ux * ux + uy * uy < (r * 2.4) ** 2) continue; }
            const d = Math.sqrt(d2), corr = ((r - d) / d) * 0.5;
            x[k] += dx * corr; x[k + 1] += dy * corr; x[k + 2] += dz * corr;
            x[kj] -= dx * corr; x[kj + 1] -= dy * corr; x[kj + 2] -= dz * corr;
          }
        }
      }
    }
  }
  layerRepulse() {
    const { x, layer, outward, cellStart, cellEntries, hashSize } = this;
    const N = this.N, cs = 2.2;
    const hash = (ix, iy, iz) => (((ix * 92837111) ^ (iy * 689287499) ^ (iz * 283923481)) >>> 0) & (hashSize - 1);
    cellStart.fill(0);
    for (let i = 0; i < N; i++) { if (layer[i] >= this.maxLayer) continue; const k = 3 * i; cellStart[hash(Math.floor(x[k] / cs), Math.floor(x[k + 1] / cs), Math.floor(x[k + 2] / cs))]++; }
    let acc = 0;
    for (let i = 0; i < hashSize; i++) { acc += cellStart[i]; cellStart[i] = acc; }
    cellStart[hashSize] = acc;
    for (let i = 0; i < N; i++) { if (layer[i] >= this.maxLayer) continue; const k = 3 * i; const hh = hash(Math.floor(x[k] / cs), Math.floor(x[k + 1] / cs), Math.floor(x[k + 2] / cs)); cellEntries[--cellStart[hh]] = i; }
    const R = 2.0;
    for (let i = 0; i < N; i++) {
      const li = layer[i];
      if (li === 0) continue;
      const k = 3 * i;
      const ix = Math.floor(x[k] / cs), iy = Math.floor(x[k + 1] / cs), iz = Math.floor(x[k + 2] / cs);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const hh = hash(ix + a, iy + b, iz + c);
        for (let e = cellStart[hh], end = cellStart[hh + 1]; e < end; e++) {
          const j = cellEntries[e];
          if (layer[j] >= li) continue;
          const kj = 3 * j;
          const dx = x[k] - x[kj], dy = x[k + 1] - x[kj + 1], dz = x[k + 2] - x[kj + 2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > R * R) continue;
          const nx = outward[kj], ny = outward[kj + 1], nz = outward[kj + 2];
          const sN = dx * nx + dy * ny + dz * nz;
          const gap = (this.thick[i] + this.thick[j]) * 0.5 + 0.25;
          if (sN >= gap) continue;
          const lat2 = d2 - sN * sN;
          if (lat2 > 1.8 * 1.8) continue;
          const push = (gap - sN) * 0.5;
          x[k] += nx * push; x[k + 1] += ny * push; x[k + 2] += nz * push;
        }
      }
    }
  }
  pick(i) {
    for (const r of this.pieces) if (i >= r.off && i < r.off + r.n) return r;
    return null;
  }
  strainColors(out) {
    // per-vertex max stretch ratio
    const { x, st, stR } = this;
    const s = new Float32Array(this.N);
    for (let c = 0; c < stR.length; c++) {
      const a = st[2 * c], b = st[2 * c + 1];
      const l = Math.hypot(x[3 * b] - x[3 * a], x[3 * b + 1] - x[3 * a + 1], x[3 * b + 2] - x[3 * a + 2]);
      const e = l / stR[c] - 1;
      if (e > s[a]) s[a] = e; if (e > s[b]) s[b] = e;
    }
    for (let i = 0; i < this.N; i++) {
      const e = clamp(s[i] / 0.08, 0, 1);
      // neutral → red (overstretched = negative)
      out[3 * i] = 0.55 + 0.4 * e; out[3 * i + 1] = 0.55 - 0.4 * e; out[3 * i + 2] = 0.55 - 0.42 * e;
    }
    return s;
  }
}

// map 2D point in old mesh → 3D using barycentric interpolation
function locator(old) {
  const { v2, tris, x } = old;
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (let i = 0; i < v2.length; i += 2) { b.x0 = Math.min(b.x0, v2[i]); b.x1 = Math.max(b.x1, v2[i]); b.y0 = Math.min(b.y0, v2[i + 1]); b.y1 = Math.max(b.y1, v2[i + 1]); }
  const cs = 4, nx = Math.max(1, Math.ceil((b.x1 - b.x0) / cs) + 1), ny = Math.max(1, Math.ceil((b.y1 - b.y0) / cs) + 1);
  const grid = Array.from({ length: nx * ny }, () => []);
  for (let t = 0; t < tris.length; t += 3) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = 0; k < 3; k++) { const i = tris[t + k]; x0 = Math.min(x0, v2[2 * i]); x1 = Math.max(x1, v2[2 * i]); y0 = Math.min(y0, v2[2 * i + 1]); y1 = Math.max(y1, v2[2 * i + 1]); }
    for (let gx = Math.floor((x0 - b.x0) / cs); gx <= Math.floor((x1 - b.x0) / cs); gx++)
      for (let gy = Math.floor((y0 - b.y0) / cs); gy <= Math.floor((y1 - b.y0) / cs); gy++) if (gx >= 0 && gy >= 0 && gx < nx && gy < ny) grid[gy * nx + gx].push(t);
  }
  return (px, py, out) => {
    const gx = Math.floor((px - b.x0) / cs), gy = Math.floor((py - b.y0) / cs);
    let best = -1, bestD = Infinity, bw = null;
    const tryCell = (cx, cy) => {
      if (cx < 0 || cy < 0 || cx >= nx || cy >= ny) return;
      for (const t of grid[cy * nx + cx]) {
        const a = tris[t], bb = tris[t + 1], c = tris[t + 2];
        const ax = v2[2 * a], ay = v2[2 * a + 1], bx = v2[2 * bb], by = v2[2 * bb + 1], cx2 = v2[2 * c], cy2 = v2[2 * c + 1];
        const den = (by - cy2) * (ax - cx2) + (cx2 - bx) * (ay - cy2);
        if (Math.abs(den) < 1e-12) continue;
        const l1 = ((by - cy2) * (px - cx2) + (cx2 - bx) * (py - cy2)) / den;
        const l2 = ((cy2 - ay) * (px - cx2) + (ax - cx2) * (py - cy2)) / den;
        const l3 = 1 - l1 - l2;
        const outside = Math.max(0, -l1) + Math.max(0, -l2) + Math.max(0, -l3);
        if (outside < bestD) { bestD = outside; best = t; bw = [l1, l2, l3]; }
      }
    };
    for (let r = 0; r <= 2 && bestD > 1e-6; r++) for (let a = -r; a <= r; a++) for (let c = -r; c <= r; c++) if (Math.max(Math.abs(a), Math.abs(c)) === r) tryCell(gx + a, gy + c);
    if (best < 0 || bestD > 0.6) return false;
    let [l1, l2, l3] = bw;
    const cl = (v) => Math.max(-0.2, v); l1 = cl(l1); l2 = cl(l2); l3 = cl(l3); const s = l1 + l2 + l3; l1 /= s; l2 /= s; l3 /= s;
    const a = tris[best], bb = tris[best + 1], c = tris[best + 2];
    for (let k = 0; k < 3; k++) out[k] = l1 * x[3 * a + k] + l2 * x[3 * bb + k] + l3 * x[3 * c + k];
    return true;
  };
}
void area;
