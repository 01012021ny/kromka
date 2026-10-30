// Parametric mannequin: measurements → lofted mesh + analytic SDF collider (same data, so cloth sits exactly on the visible body)
import * as THREE from 'three';
import { lerp, clamp } from './util.js';

const F_REF = { H: 168, W: 60, bf: 27, chest: 88, under: 74, waist: 70, hips: 96, neck: 34, shoulder: 38.5, upperArm: 27.5, wrist: 15.5, thigh: 55, knee: 36, calf: 35, ankle: 22 };
const M_REF = { H: 180, W: 78, bf: 17, chest: 100, under: 92, waist: 84, hips: 98, neck: 39, shoulder: 45, upperArm: 31, wrist: 17.5, thigh: 56, knee: 39, calf: 38, ankle: 24 };

export const BODY_DEFAULT = { sex: 0.15, height: 172, weight: 59, bf: 21, arms: 24, overrides: {} };

export const MEAS_LABELS = {
  chest: 'Обхват груди', underbust: 'Под грудью', waist: 'Талия', hips: 'Бёдра', neck: 'Шея', shoulder: 'Ширина плеч',
  upperArm: 'Обхват плеча', wrist: 'Запястье', thigh: 'Обхват бедра', knee: 'Колено', calf: 'Икра', ankle: 'Щиколотка',
  armLen: 'Длина руки', inseam: 'Шаговый шов',
};

export function measure(b) {
  const s = clamp(b.sex, 0, 1);
  const R = {};
  for (const k in F_REF) R[k] = lerp(F_REF[k], M_REF[k], s);
  const H = b.height, W = b.weight, bf = b.bf;
  const k = Math.sqrt(W / H / (R.W / R.H));
  const fd = bf - R.bf;
  const hs = H / R.H;
  const m = {
    height: H,
    chest: R.chest * k + fd * 0.12,
    underbust: R.under * k + fd * 0.18,
    waist: R.waist * k + fd * (0.42 + 0.3 * s),
    hips: R.hips * k + fd * (0.5 - 0.22 * s),
    neck: R.neck * Math.sqrt(k * hs) + fd * 0.08,
    shoulder: R.shoulder * hs * (0.82 + 0.18 * k) - fd * 0.04,
    upperArm: R.upperArm * k + fd * 0.2,
    wrist: R.wrist * Math.sqrt(hs * k),
    thigh: R.thigh * k + fd * (0.32 - 0.1 * s),
    knee: R.knee * k + fd * 0.05,
    calf: R.calf * k + fd * 0.1,
    ankle: R.ankle * Math.sqrt(hs * k),
    armLen: 0.338 * H,
    inseam: 0.452 * H,
  };
  for (const key in b.overrides || {}) if (b.overrides[key] != null && key in m) m[key] = +b.overrides[key];
  m.sex = s;
  m.fd = fd;
  // vertical landmarks (body coordinates, cm from floor)
  const crotch = Math.min(H * 0.475, m.inseam + 1.5);
  m.y = {
    top: H, chin: H * 0.868, neckBase: H * 0.838, shoulder: H * 0.816, armpit: H * 0.733, bust: H * 0.72, under: H * 0.684,
    waist: H * (0.622 + 0.008 * (1 - s)), highHip: H * 0.57, hip: H * 0.518, crotch, knee: H * 0.285, calf: H * 0.22, ankle: H * 0.045,
    headC: H - H * 0.066,
  };
  return m;
}

// superellipse helpers -------------------------------------------------------
const SE_N = 2.35;
function sePoint(a, bF, bB, th, n = SE_N) {
  const s = Math.sin(th), c = Math.cos(th), e = 2 / n;
  return [a * Math.sign(s) * Math.abs(s) ** e, (c >= 0 ? bF : bB) * Math.sign(c) * Math.abs(c) ** e];
}
function sePerim(a, bF, bB) {
  let L = 0, prev = sePoint(a, bF, bB, 0);
  for (let i = 1; i <= 96; i++) {
    const p = sePoint(a, bF, bB, (i / 96) * Math.PI * 2);
    L += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return L;
}
function ringFromGirth(g, ra, rf, rb) {
  const P = sePerim(ra, rf, rb);
  const k = g / P;
  return { a: ra * k, bF: rf * k, bB: rb * k };
}
// monotone cubic (Fritsch–Carlson)
function monotone(xs, ys) {
  const n = xs.length, d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function loft(rings, capStart, capEnd) {
  const N = rings[0].length;
  const pos = [], idx = [];
  for (const r of rings) for (const p of r) pos.push(p.x, p.y, p.z);
  for (let j = 0; j < rings.length - 1; j++)
    for (let i = 0; i < N; i++) {
      const a = j * N + i, b = j * N + ((i + 1) % N), c = (j + 1) * N + i, d = (j + 1) * N + ((i + 1) % N);
      idx.push(a, c, b, b, c, d);
    }
  const cap = (ring, base, flip) => {
    const c = new THREE.Vector3();
    ring.forEach((p) => c.add(p));
    c.multiplyScalar(1 / ring.length);
    const ci = pos.length / 3;
    pos.push(c.x, c.y, c.z);
    for (let i = 0; i < N; i++) flip ? idx.push(ci, base + ((i + 1) % N), base + i) : idx.push(ci, base + i, base + ((i + 1) % N));
  };
  if (capStart) cap(rings[0], 0, false);
  if (capEnd) cap(rings[rings.length - 1], (rings.length - 1) * N, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function tubeRings(joints, N = 28, sub = 4) {
  // joints: [{p:Vector3, r}] → smooth rings
  const pts = [], rad = [];
  for (let j = 0; j < joints.length - 1; j++) {
    const P = (k) => joints[clamp(k, 0, joints.length - 1)];
    for (let s = 0; s < sub; s++) {
      const t = s / sub;
      const p0 = P(j - 1), p1 = P(j), p2 = P(j + 1), p3 = P(j + 2);
      const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
      pts.push(V(cr(p0.p.x, p1.p.x, p2.p.x, p3.p.x), cr(p0.p.y, p1.p.y, p2.p.y, p3.p.y), cr(p0.p.z, p1.p.z, p2.p.z, p3.p.z)));
      rad.push(Math.max(0.3, lerp(p1.r, p2.r, t * t * (3 - 2 * t))));
    }
  }
  const last = joints[joints.length - 1];
  pts.push(last.p.clone()); rad.push(last.r);
  const rings = [];
  for (let i = 0; i < pts.length; i++) {
    const d = (i < pts.length - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
    const ref = Math.abs(d.z) < 0.9 ? V(0, 0, 1) : V(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(d, ref).normalize();
    const v = new THREE.Vector3().crossVectors(d, u).normalize();
    const ring = [];
    for (let k = 0; k < N; k++) {
      const th = (k / N) * Math.PI * 2;
      ring.push(pts[i].clone().addScaledVector(u, Math.cos(th) * rad[i]).addScaledVector(v, Math.sin(th) * rad[i]));
    }
    rings.push(ring);
  }
  // rounded ends
  const endCap = (ringIdx, dirSign) => {
    const c = pts[ringIdx], r = rad[ringIdx];
    const d = (dirSign > 0 ? pts[pts.length - 1].clone().sub(pts[pts.length - 2]) : pts[0].clone().sub(pts[1])).normalize();
    const extra = [];
    for (let s = 1; s <= 4; s++) {
      const a = (s / 4) * Math.PI * 0.5;
      const base = rings[ringIdx];
      extra.push(base.map((p) => c.clone().add(p.clone().sub(c).multiplyScalar(Math.cos(a))).addScaledVector(d, Math.sin(a) * r)));
    }
    return extra;
  };
  const start = endCap(0, -1).reverse(), end = endCap(pts.length - 1, 1);
  return { rings: [...start, ...rings, ...end], pts, rad };
}

export class Body {
  constructor(scene) {
    this.group = scene ? new THREE.Group() : null; // headless (worker) when no scene
    if (scene) scene.add(this.group);
    this.mat = new THREE.MeshStandardMaterial({ color: 0x8f8a83, roughness: 0.9, metalness: 0 });
    this.measureMat = new THREE.LineBasicMaterial({ color: 0xd9d4c7, transparent: true, opacity: 0.55 });
    this.showMeasures = false;
    this.hideFeet = false;
  }
  build(params, opts = {}) {
    const m = (this.m = measure(params));
    const Y = m.y, s = m.sex, H = m.height;
    const fd = m.fd;
    const shape = (f, mm) => lerp(f, mm, s);
    const rings = [];
    const add = (y, r, zc = 0) => rings.push({ y, a: r.a, bF: r.bF, bB: r.bB, zc });
    const belly = clamp(fd * 0.008, -0.05, 0.18);
    add(Y.crotch - 0.5, ringFromGirth(m.hips * 0.86, 1, 0.56, 0.66), -0.6);
    add(Y.crotch + (Y.hip - Y.crotch) * 0.45, ringFromGirth(m.hips * 0.97, 1, 0.6, shape(0.76, 0.69)), -0.6);
    add(Y.hip, ringFromGirth(m.hips, 1, 0.6, shape(0.8, 0.7)), -0.5);
    add(Y.highHip, ringFromGirth((m.waist + m.hips) / 2 + 1, 1, 0.64 + belly * 0.6, shape(0.7, 0.66)), -0.3);
    add(Y.waist, ringFromGirth(m.waist, 1, 0.7 + belly, 0.64), 0);
    add(Y.under, ringFromGirth(m.underbust, 1, shape(0.66, 0.66) + belly * 0.3, 0.66), 0);
    add(Y.bust, ringFromGirth(m.chest, 1, shape(0.86, 0.66), shape(0.62, 0.66)), 0);
    add(Y.armpit + 1.5, ringFromGirth(m.chest * shape(0.93, 0.99), 1, 0.58, 0.62), -0.2);
    const shA = m.shoulder / 2;
    add(Y.shoulder - 5, { a: shA * 0.93, bF: shA * 0.42, bB: shA * 0.47 }, -0.6);
    add(Y.shoulder - 1, { a: shA * 0.86, bF: shA * 0.33, bB: shA * 0.4 }, -1);
    add(Y.shoulder + 1.6, { a: shA * 0.6, bF: shA * 0.3, bB: shA * 0.36 }, -1.4);
    const nr = m.neck / (2 * Math.PI);
    add(Y.neckBase + 1, { a: nr * 1.18, bF: nr * 1.05, bB: nr * 1.1 }, -1.6);
    add(Y.neckBase + 4, { a: nr, bF: nr * 0.98, bB: nr }, -1.2);
    add(Y.chin, { a: nr * 0.96, bF: nr * 0.95, bB: nr * 0.98 }, -0.8);
    add(Y.headC, { a: nr * 0.9, bF: nr * 0.9, bB: nr * 0.9 }, -0.4);
    const ys = rings.map((r) => r.y);
    const fa = monotone(ys, rings.map((r) => r.a)), ff = monotone(ys, rings.map((r) => r.bF)), fb = monotone(ys, rings.map((r) => r.bB)), fz = monotone(ys, rings.map((r) => r.zc));
    // collider table
    this.ty0 = ys[0]; this.ty1 = ys[ys.length - 1]; this.tdy = 0.5;
    const nT = Math.ceil((this.ty1 - this.ty0) / this.tdy) + 1;
    this.tA = new Float32Array(nT); this.tF = new Float32Array(nT); this.tB = new Float32Array(nT); this.tZ = new Float32Array(nT);
    for (let i = 0; i < nT; i++) {
      const y = this.ty0 + i * this.tdy;
      this.tA[i] = fa(y); this.tF[i] = ff(y); this.tB[i] = fb(y); this.tZ[i] = fz(y);
    }
    this.ring = (y) => {
      const i = clamp(Math.round((y - this.ty0) / this.tdy), 0, nT - 1);
      return { a: this.tA[i], bF: this.tF[i], bB: this.tB[i], zc: this.tZ[i] };
    };
    // limbs ----------------------------------------------------------------
    const rUA = m.upperArm / (2 * Math.PI), rW = m.wrist / (2 * Math.PI);
    const armA = ((params.arms ?? 14) * Math.PI) / 180;
    this.arms = [];
    for (const sg of [1, -1]) {
      const J = V(sg * (shA - rUA * 0.8), Y.shoulder - rUA * 0.7, -0.8);
      const d = V(sg * Math.sin(armA), -Math.cos(armA), 0);
      const up = 0.186 * H, fo = 0.146 * H;
      const E = J.clone().addScaledVector(d, up), Wp = E.clone().addScaledVector(d, fo);
      const joints = [
        { p: J.clone().addScaledVector(d, -1.5), r: rUA * 1.1 },
        { p: J.clone().addScaledVector(d, up * 0.35), r: rUA },
        { p: E.clone(), r: rUA * 0.8 },
        { p: E.clone().addScaledVector(d, fo * 0.28), r: rUA * 0.86 },
        { p: Wp.clone(), r: rW },
      ];
      const hand = Wp.clone().addScaledVector(d, 0.105 * H);
      const o = V(sg * Math.cos(armA), Math.sin(armA), 0);
      this.arms.push({ sg, J, d, o, joints, wrist: Wp, hand, len: up + fo, rUA });
    }
    const hipR = this.ring(Y.hip);
    const legX = hipR.a * 0.47;
    const rT = m.thigh / (2 * Math.PI), rK = m.knee / (2 * Math.PI), rC = m.calf / (2 * Math.PI), rAn = m.ankle / (2 * Math.PI);
    this.legs = [];
    for (const sg of [1, -1]) {
      const top = V(sg * legX, Y.crotch + 5, -0.4), ank = V(sg * (legX + 1.8), Y.ankle + 1, -1.2);
      const at = (y) => { const t = (top.y - y) / (top.y - ank.y); return V(lerp(top.x, ank.x, t), y, lerp(top.z, ank.z, t)); };
      const joints = [
        { p: at(Y.crotch + 5), r: rT * 1.04 },
        { p: at(Y.crotch - 3), r: rT },
        { p: at(Y.crotch - (Y.crotch - Y.knee) * 0.45), r: rT * 0.86 },
        { p: at(Y.knee + 5), r: rK * 1.06 },
        { p: at(Y.knee), r: rK },
        { p: at(Y.calf), r: rC },
        { p: at(Y.ankle + (Y.calf - Y.ankle) * 0.4), r: rAn * 1.22 },
        { p: at(Y.ankle + 1), r: rAn },
      ];
      this.legs.push({ sg, joints, ank, x: legX, rT });
    }
    this.footLen = 0.152 * H;
    // capsules for collider
    const caps = [];
    const capsFrom = (joints) => { for (let i = 0; i < joints.length - 1; i++) caps.push(mkCap(joints[i].p, joints[i + 1].p, joints[i].r, joints[i + 1].r)); };
    for (const a of this.arms) {
      capsFrom(a.joints);
      caps.push(mkCap(a.wrist.clone().addScaledVector(a.d, 2), a.hand.clone().addScaledVector(a.d, -2.5), rW * 0.95, rW * 0.8));
    }
    for (const l of this.legs) {
      capsFrom(l.joints);
      const heel = V(l.ank.x, 3.2, l.ank.z - 4.5), toe = V(l.ank.x + 1.2 * l.sg, 2.4, l.ank.z - 4.5 + this.footLen - 4.5);
      caps.push(mkCap(heel, toe, 3.3, 2.6));
      caps.push(mkCap(V(l.ank.x, Y.ankle + 1, l.ank.z), heel, rAn, 3.3));
      l.heel = heel; l.toe = toe;
    }
    caps.push(mkCap(V(0, Y.headC - 4, 0.6), V(0, Y.headC + 4, -0.2), 8.6, 8.4));
    this.caps = caps;
    this.extraCaps = this.extraCaps || [];
    if (this.group) this._mesh(fa, ff, fb, fz, rings);
    if (!opts.noGrid) this.buildGrid();
  }
  _mesh(fa, ff, fb, fz, rings) {
    for (const c of [...this.group.children]) { this.group.remove(c); c.geometry?.dispose(); }
    const N = 56;
    const y0 = rings[0].y, y1 = rings[rings.length - 1].y;
    const tr = [];
    for (let y = y0; y <= y1 + 0.01; y += 1) {
      const a = fa(y), bF = ff(y), bB = fb(y), zc = fz(y);
      const r = [];
      for (let i = 0; i < N; i++) { const p = sePoint(a, bF, bB, (i / N) * Math.PI * 2); r.push(V(p[0], y, p[1] + zc)); }
      tr.push(r);
    }
    const torso = new THREE.Mesh(loft(tr, true, false), this.mat);
    const head = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), this.mat);
    const H = this.m.height;
    head.scale.set(0.046 * H, 0.068 * H, 0.056 * H);
    head.position.set(0, this.m.y.headC + 0.5, 0.5);
    const meshes = [torso, head];
    for (const a of this.arms) {
      meshes.push(new THREE.Mesh(loft(tubeRings(a.joints).rings), this.mat));
      const hand = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), this.mat);
      const mid = a.wrist.clone().lerp(a.hand, 0.5);
      hand.position.copy(mid);
      const mtx = new THREE.Matrix4().makeBasis(a.o, a.d, V(0, 0, a.sg > 0 ? -1 : 1));
      hand.quaternion.setFromRotationMatrix(mtx);
      hand.scale.set(1.6, 0.05 * H, 0.025 * H);
      meshes.push(hand);
    }
    this.feet = [];
    for (const l of this.legs) {
      meshes.push(new THREE.Mesh(loft(tubeRings(l.joints).rings), this.mat));
      const foot = new THREE.Mesh(footGeom(this.footLen, l.sg), this.mat);
      foot.position.set(l.ank.x, 0, l.ank.z - 4.5);
      meshes.push(foot);
      this.feet.push(foot);
    }
    for (const mm of meshes) { mm.castShadow = true; mm.receiveShadow = true; this.group.add(mm); }
    // measurement rings
    this.measureGroup = new THREE.Group();
    for (const key of ['bust', 'waist', 'hip']) {
      const y = this.m.y[key], r = this.ring(y), pts = [];
      for (let i = 0; i <= 72; i++) { const p = sePoint(r.a + 0.25, r.bF + 0.25, r.bB + 0.25, (i / 72) * Math.PI * 2); pts.push(V(p[0], y, p[1] + r.zc)); }
      this.measureGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.measureMat));
    }
    this.measureGroup.visible = this.showMeasures;
    this.group.add(this.measureGroup);
    this.setFeetVisible(!this.hideFeet);
  }
  setFeetVisible(v) { for (const f of this.feet || []) f.visible = v; }
  // signed distance + outward normal (smooth union of torso + capsules, k = fillet size); out = [nx,ny,nz]
  sdfExact(x, y, z, out) {
    let best = 1e9, nx = 0, ny = 1, nz = 0, has = false;
    const K = 2.6;
    if (y >= this.ty0 - 2 && y <= this.ty1) {
      const yy = y > this.ty0 ? y : this.ty0;
      const nT = this.tA.length;
      let i0 = Math.round((yy - this.ty0) / this.tdy); if (i0 > nT - 1) i0 = nT - 1;
      let i1 = i0 + 2; if (i1 > nT - 1) i1 = nT - 1;
      const a = this.tA[i0], zc = this.tZ[i0];
      const dz = z - zc, b = dz >= 0 ? this.tF[i0] : this.tB[i0];
      const ax = Math.abs(x) / a, az = Math.abs(dz) / b;
      const f = Math.pow(ax, SE_N) + Math.pow(az, SE_N);
      const rr = Math.sqrt(x * x + dz * dz);
      if (rr > 1e-6 && f > 1e-9) {
        const rs = rr * Math.pow(f, -1 / SE_N);
        const a2 = this.tA[i1], zc2 = this.tZ[i1], dz2 = z - zc2, b2 = dz2 >= 0 ? this.tF[i1] : this.tB[i1];
        const f2 = Math.pow(Math.abs(x) / a2, SE_N) + Math.pow(Math.abs(dz2) / b2, SE_N);
        const rr2 = Math.sqrt(x * x + dz2 * dz2);
        const rs2 = f2 > 1e-9 ? rr2 * Math.pow(f2, -1 / SE_N) : rs;
        let slope = (rs2 - rs) / Math.max(1e-6, (i1 - i0) * this.tdy);
        slope = slope < -6 ? -6 : slope > 6 ? 6 : slope;
        const k = 1 / Math.sqrt(1 + slope * slope);
        let d = (rr - rs) * k;
        const gx = Math.sign(x) * Math.pow(ax, SE_N - 1) / a, gz = Math.sign(dz) * Math.pow(az, SE_N - 1) / b;
        const gl = Math.sqrt(gx * gx + gz * gz) || 1;
        nx = (gx / gl) * k; ny = -slope * k; nz = (gz / gl) * k;
        if (y < this.ty0) { const dd = this.ty0 - y; if (dd > d) d = dd; nx *= 0.3; ny = -1; nz *= 0.3; }
        best = d; has = true;
      }
    }
    const caps = this.caps, ec = this.extraCaps, nc = caps.length;
    for (let q = 0, n = nc + ec.length; q < n; q++) {
      const c = q < nc ? caps[q] : ec[q - nc];
      if (x < c.minx || x > c.maxx || y < c.miny || y > c.maxy || z < c.minz || z > c.maxz) continue;
      const px = x - c.ax, py = y - c.ay, pz = z - c.az;
      let t = (px * c.dx + py * c.dy + pz * c.dz) * c.il2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = px - c.dx * t, qy = py - c.dy * t, qz = pz - c.dz * t;
      const l = Math.sqrt(qx * qx + qy * qy + qz * qz);
      const d = l - (c.ra + (c.rb - c.ra) * t);
      let mx = 0, my = 1, mz = 0;
      if (l > 1e-6) { mx = qx / l; my = qy / l; mz = qz / l; }
      if (!has) { best = d; nx = mx; ny = my; nz = mz; has = true; continue; }
      const diff = d - best;
      if (diff >= K) continue;
      if (diff <= -K) { best = d; nx = mx; ny = my; nz = mz; continue; }
      const hh = 0.5 + (0.5 * diff) / K; // weight of current best
      best = d + (best - d) * hh - K * hh * (1 - hh);
      nx = mx + (nx - mx) * hh; ny = my + (ny - my) * hh; nz = mz + (nz - mz) * hh;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
    }
    out[0] = nx; out[1] = ny; out[2] = nz;
    return has ? best : 1e9;
  }
  // voxelised SDF for fast cloth collision (trilinear value + analytic gradient)
  buildGrid() {
    const cs = 1.5;
    let x0 = -this.m.shoulder / 2 - 12, x1 = -x0, z0 = -24, z1 = 26;
    for (const c of [...this.caps, ...this.extraCaps]) {
      x0 = Math.min(x0, c.ax - c.ra - 6, c.ax + c.dx - c.rb - 6); x1 = Math.max(x1, c.ax + c.ra + 6, c.ax + c.dx + c.rb + 6);
      z0 = Math.min(z0, c.az - c.ra - 6, c.az + c.dz - c.rb - 6); z1 = Math.max(z1, c.az + c.ra + 6, c.az + c.dz + c.rb + 6);
    }
    const y0 = -2, y1 = this.m.height + 6;
    const nx = Math.ceil((x1 - x0) / cs) + 1, ny = Math.ceil((y1 - y0) / cs) + 1, nz = Math.ceil((z1 - z0) / cs) + 1;
    const d = new Float32Array(nx * ny * nz), o = [0, 0, 0];
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      d[(k * ny + j) * nx + i] = Math.min(12, this.sdfExact(x0 + i * cs, y0 + j * cs, z0 + k * cs, o));
    }
    this.grid = { x0, y0, z0, cs, ics: 1 / cs, nx, ny, nz, d };
  }
  sdf(x, y, z, out) {
    const G = this.grid;
    if (!G) return this.sdfExact(x, y, z, out);
    const fx = (x - G.x0) * G.ics, fy = (y - G.y0) * G.ics, fz = (z - G.z0) * G.ics;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    if (i < 0 || j < 0 || k < 0 || i >= G.nx - 1 || j >= G.ny - 1 || k >= G.nz - 1) { out[0] = 0; out[1] = 1; out[2] = 0; return 12; }
    const tx = fx - i, ty = fy - j, tz = fz - k, nx = G.nx, nxy = G.nx * G.ny, D = G.d;
    const b = k * nxy + j * nx + i;
    const c000 = D[b], c100 = D[b + 1], c010 = D[b + nx], c110 = D[b + nx + 1];
    const c001 = D[b + nxy], c101 = D[b + nxy + 1], c011 = D[b + nxy + nx], c111 = D[b + nxy + nx + 1];
    const x00 = c000 + (c100 - c000) * tx, x10 = c010 + (c110 - c010) * tx, x01 = c001 + (c101 - c001) * tx, x11 = c011 + (c111 - c011) * tx;
    const y0 = x00 + (x10 - x00) * ty, y1 = x01 + (x11 - x01) * ty;
    const v = y0 + (y1 - y0) * tz;
    // gradient
    const gx = ((c100 - c000) * (1 - ty) + (c110 - c010) * ty) * (1 - tz) + ((c101 - c001) * (1 - ty) + (c111 - c011) * ty) * tz;
    const gy = (x10 - x00) * (1 - tz) + (x11 - x01) * tz;
    const gz = y1 - y0;
    const gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    out[0] = gx / gl; out[1] = gy / gl; out[2] = gz / gl;
    return v;
  }
}


function mkCap(a, b, ra, rb) {
  const r = Math.max(ra, rb) + 6;
  return {
    ax: a.x, ay: a.y, az: a.z, dx: b.x - a.x, dy: b.y - a.y, dz: b.z - a.z,
    il2: 1 / Math.max(1e-9, (b.x - a.x) ** 2 + (b.y - a.y) ** 2 + (b.z - a.z) ** 2), ra, rb,
    minx: Math.min(a.x, b.x) - r, maxx: Math.max(a.x, b.x) + r, miny: Math.min(a.y, b.y) - r, maxy: Math.max(a.y, b.y) + r,
    minz: Math.min(a.z, b.z) - r, maxz: Math.max(a.z, b.z) + r,
  };
}
export { mkCap };

function footGeom(L, sg) {
  const rings = [], N = 24;
  for (let i = 0; i <= 20; i++) {
    const u = i / 20;
    const w = (3.0 + 1.9 * Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.7) * (u > 0.85 ? Math.sqrt(Math.max(0.05, (1 - u) / 0.15)) : 1);
    const h = lerp(7.5, 2.2, Math.min(1, u * 1.25)) * (u < 0.06 ? 0.8 : 1);
    const z = u * L, xo = sg * u * 1.2;
    const r = [];
    for (let k = 0; k < N; k++) {
      const th = (k / N) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      r.push(V(xo + w * s, Math.max(0.2, h * 0.5 + h * 0.5 * c), z));
    }
    rings.push(r);
  }
  return loft(rings, true, true);
}
