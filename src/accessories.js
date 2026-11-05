// @ts-check
// Parametric footwear and accessories (meshes + colliders / cinch constraints)
import * as THREE from 'three';
import { mkCap } from './body.js';
import { clamp, lerp, uid } from './util.js';

export const METALS = { silver: { n: 'Серебро', color: '#c9c9c9', metal: 1, rough: 0.28 }, gunmetal: { n: 'Оружейный металл', color: '#4b4c4f', metal: 1, rough: 0.35 }, brass: { n: 'Латунь', color: '#b39250', metal: 1, rough: 0.32 }, black: { n: 'Чернёный', color: '#1b1b1c', metal: 1, rough: 0.45 } };

export const ACC_TYPES = {
  shoes: { n: 'Обувь', params: [['style', 'Тип', ['high', 'Высокие кеды'], ['low', 'Низкие кеды'], ['boot', 'Ботинки'], ['tall', 'Высокие сапоги'], ['derby', 'Дерби']], ['toe', 'Носок', ['round', 'круглый'], ['square', 'квадратный'], ['point', 'острый']], ['shaft', 'Высота голенища, см', 0, 60, 1], ['sole', 'Толщина подошвы, см', 0.8, 8, 0.1], ['heel', 'Каблук, см', 0, 10, 0.5], ['flare', 'Свобода голенища, см', 0, 6, 0.1], ['laces', 'Шнуровка (0/1)', 0, 1, 1]] },
  belt: { n: 'Ремень / стропа', params: [['y', 'Высота, см', 60, 150, 0.5], ['w', 'Ширина, см', 1, 12, 0.5], ['slack', 'Свобода, см', 0, 8, 0.5], ['buckle', 'Пряжка (0/1)', 0, 1, 1], ['cinch', 'Стягивает ткань (0/1)', 0, 1, 1]] },
  chain: { n: 'Цепь', params: [['at', 'Где', ['neck', 'шея'], ['waist', 'пояс']], ['sag', 'Провис, см', 0, 40, 0.5], ['link', 'Размер звена, см', 0.4, 3, 0.1]] },
  bag: { n: 'Сумка через плечо', params: [['w', 'Ширина', 10, 50, 1], ['h', 'Высота', 8, 45, 1], ['d', 'Глубина', 2, 20, 0.5], ['side', 'Сторона', ['L', 'слева'], ['R', 'справа']], ['strap', 'Ширина ремня', 1, 6, 0.5]] },
  beanie: { n: 'Шапка-бини', params: [['slouch', 'Объём макушки, см', 0, 18, 0.5], ['cuff', 'Отворот, см', 0, 8, 0.5], ['depth', 'Глубина посадки, см', 6, 16, 0.5]] },
};

export function makeAcc(type, matId) {
  const d = {
    shoes: { style: 'high', toe: 'round', shaft: 16, sole: 3.2, heel: 0, flare: 0.8, laces: 1 },
    belt: { y: 100, w: 3.5, slack: 0.5, buckle: 1, cinch: 1 },
    chain: { at: 'neck', sag: 16, link: 1.2 },
    bag: { w: 24, h: 18, d: 7, side: 'L', strap: 3 },
    beanie: { slouch: 6, cuff: 4, depth: 11 },
  }[type];
  return { id: uid('a'), type, name: ACC_TYPES[type].n, p: { ...d }, mat: matId, metal: type === 'chain' ? 'silver' : 'gunmetal', visible: true };
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function loftGeom(rings, capStart = true, capEnd = true) {
  const N = rings[0].length, pos = [], idx = [];
  for (const r of rings) for (const p of r) pos.push(p.x, p.y, p.z);
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < N; i++) {
    const a = j * N + i, b = j * N + ((i + 1) % N), c = (j + 1) * N + i, d = (j + 1) * N + ((i + 1) % N);
    idx.push(a, c, b, b, c, d);
  }
  const cap = (k, flip) => {
    const c = new THREE.Vector3(); rings[k].forEach((p) => c.add(p)); c.multiplyScalar(1 / N);
    const ci = pos.length / 3; pos.push(c.x, c.y, c.z);
    for (let i = 0; i < N; i++) flip ? idx.push(ci, k * N + ((i + 1) % N), k * N + i) : idx.push(ci, k * N + i, k * N + ((i + 1) % N));
  };
  if (capStart) cap(0, false);
  if (capEnd) cap(rings.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function shoeHalfWidth(u, toe) {
  const ball = 4.9, heel = 3.5;
  let w = u < 0.7 ? lerp(heel, ball, Math.sin((u / 0.7) * Math.PI * 0.5)) : ball;
  if (u > 0.72) {
    const t = (u - 0.72) / 0.28;
    if (toe === 'round') w = ball * Math.sqrt(Math.max(0, 1 - t * t * 0.92));
    else if (toe === 'square') w = ball * (t < 0.8 ? 1 - t * 0.12 : (1 - 0.1) * Math.sqrt(Math.max(0, 1 - ((t - 0.8) / 0.2) ** 4)));
    else w = ball * (1 - t * 0.9);
  }
  return Math.max(0.25, w);
}

// геометрия обуви одной ноги (без мешей): длина, носок, подошва, контур — общая для модели, коллизии и проверок
export function shoeShape(body, leg, p) {
  const L = body.footLen + 2.2 + (p.toe === 'point' ? 4 : p.toe === 'square' ? 1.5 : 0);
  const sole = p.sole, heelH = p.heel, heelZ = leg.heel.z - 2.2, sg = leg.sg, x0 = leg.ank.x;
  const footTop = (u) => {
    if (u < 0.45) return 9.5 + heelH * 0.3;
    const t = (u - 0.45) / 0.55;
    const toeH = p.toe === 'point' ? 3 : p.toe === 'square' ? 4.4 : 4.8;
    return lerp(9.5, toeH, Math.pow(t, 0.8));
  };
  const lift = (u) => sole + heelH * (1 - clamp((u - 0.25) / 0.35, 0, 1)) + (u > 0.82 ? ((u - 0.82) / 0.18) ** 2 * 1.4 : 0);
  const halfW = (u) => shoeHalfWidth(u, p.toe) + 0.4;
  const cx = (u) => x0 + sg * u * 1.2, cz = (u) => heelZ + u * L;
  // точка внутри объёма обуви (без голенища) глубже tol см?
  const inside = (x, y, z, tol = 0) => { const u = (z - heelZ) / L; if (u < tol / L || u > 1 - tol / L) return false; return Math.abs(x - cx(u)) < halfW(u) - tol && y < lift(u) + footTop(u) - tol && y > -0.5; };
  return { L, sole, heelH, heelZ, sg, x0, footTop, lift, halfW, cx, cz, inside };
}

export function buildShoe(body, leg, p, upperMat, soleMat) {
  const grp = new THREE.Group();
  const L = body.footLen + 2.2 + (p.toe === 'point' ? 4 : p.toe === 'square' ? 1.5 : 0);
  const sole = p.sole, heelH = p.heel;
  const heelZ = leg.heel.z - 2.2;
  const sg = leg.sg;
  const x0 = leg.ank.x;
  const nU = 34, N = 26;
  const footTop = (u) => { // top of upper above sole
    if (u < 0.45) return 9.5 + heelH * 0.3;
    const t = (u - 0.45) / 0.55;
    const toeH = p.toe === 'point' ? 3 : p.toe === 'square' ? 4.4 : 4.8;
    return lerp(9.5, toeH, Math.pow(t, 0.8));
  };
  const lift = (u) => sole + heelH * (1 - clamp((u - 0.25) / 0.35, 0, 1)) + (u > 0.82 ? ((u - 0.82) / 0.18) ** 2 * 1.4 : 0);
  // upper
  const rings = [];
  for (let i = 0; i <= nU; i++) {
    const u = i / nU, z = heelZ + u * L, w = shoeHalfWidth(u, p.toe) + 0.4, top = footTop(u) * (u < 0.04 ? 0.92 : 1);
    const base = lift(u);
    const r = [];
    for (let k = 0; k < N; k++) {
      const th = (k / N) * Math.PI * 2;
      const s = Math.sin(th), c = Math.cos(th);
      const yy = c >= 0 ? base + top * Math.pow(c, 0.85) : base - 0.05 * Math.abs(c);
      r.push(V(x0 + sg * u * 1.2 + w * s * (c < 0 ? 1 : 1 - 0.12 * c), yy, z));
    }
    rings.push(r);
  }
  const upperG = loftGeom(rings);
  grp.add(new THREE.Mesh(upperG, upperMat));
  // sole slab
  const sr = [];
  const outline = [];
  for (let i = 0; i <= nU; i++) { const u = i / nU; outline.push([u, shoeHalfWidth(u, p.toe) + 0.75]); }
  const pts = [...outline.map(([u, w]) => [x0 + sg * u * 1.2 + w, heelZ + u * L, u]), ...outline.slice().reverse().map(([u, w]) => [x0 + sg * u * 1.2 - w, heelZ + u * L, u])];
  for (const yy of ['b', 't']) {
    sr.push(pts.map(([x, z, u]) => {
      const lb = (u > 0.82 ? ((u - 0.82) / 0.18) ** 2 * 1.4 : 0);
      return V(x, yy === 'b' ? -0.0 + lb : lift(u) + 0.15, z);
    }));
  }
  const soleG = loftGeom(sr);
  grp.add(new THREE.Mesh(soleG, soleMat));
  // shaft
  const shaftTop = Math.max(0, p.shaft);
  if (shaftTop > 8) {
    const lj = leg.joints;
    const sr2 = [];
    const at = (y) => { // leg axis point & radius at height y
      for (let i = lj.length - 1; i > 0; i--) {
        const a = lj[i], b = lj[i - 1];
        if (y >= a.p.y && y <= b.p.y) { const t = (y - a.p.y) / (b.p.y - a.p.y); return { p: a.p.clone().lerp(b.p, t), r: lerp(a.r, b.r, t) }; }
      }
      const a = lj[lj.length - 1]; return { p: a.p.clone().setY(y), r: a.r };
    };
    for (let y = 5; y <= shaftTop + 0.01; y += Math.max(1, (shaftTop - 5) / 24)) {
      const q = at(Math.max(y, lj[lj.length - 1].p.y));
      const r = q.r + 0.7 + p.flare * clamp((y - 8) / 30, 0, 1);
      const ring = [];
      for (let k = 0; k < N; k++) { const th = (k / N) * Math.PI * 2; ring.push(V(q.p.x + Math.sin(th) * r * 1.02, y, q.p.z + Math.cos(th) * r * (y < 12 ? 1.25 : 1) + (y < 12 ? 0.8 : 0))); }
      sr2.push(ring);
    }
    if (sr2.length > 1) {
      const g = loftGeom(sr2, false, false);
      const m = new THREE.Mesh(g, upperMat.clone()); m.material.side = THREE.DoubleSide;
      grp.add(m);
      body.extraCaps.push(Object.assign(mkCap(V(x0, 6, leg.ank.z), V(lj[2].p.x, shaftTop, lj[2].p.z), at(8).r + 0.9, at(shaftTop).r + 0.9 + p.flare), { foot: shaftTop < 30 }));
    }
  }
  // laces
  if (p.laces) {
    const lm = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
    for (let i = 0; i < 6; i++) {
      const u = 0.5 + i * 0.045, z = heelZ + u * L, y = lift(u) + footTop(u) + 0.15;
      const b = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.25, 0.45), lm);
      b.position.set(x0 + sg * u * 1.2, y, z); b.rotation.x = -0.35;
      grp.add(b);
    }
  }
  // коллизия обуви по её форме: решётка капсул 2 (лево/право) × 3 (низ/середина/верх) вдоль стопы, от пола до верха,
  // с запасом 0,3 см — ткань ложится на обувь, а не проходит сквозь (одна капсула не покрывала ни подошву, ни верх у пятки)
  const sh = shoeShape(body, leg, p);
  const us = [0.04, 0.28, 0.52, 0.76, 0.97];
  const sec = us.map((u) => { const w = sh.halfW(u) + 0.3, top = sh.lift(u) + sh.footTop(u) + 0.3, r = Math.max(0.8, Math.min(w, top / 2)); return { u, w, top, r }; });
  for (const sx of [-1, 1]) for (const lev of [0, 0.5, 1]) {
    for (let i = 0; i < sec.length - 1; i++) {
      const pt = (q) => V(sh.cx(q.u) + sx * Math.max(0, q.w - q.r), q.r + (Math.max(q.r, q.top - q.r) - q.r) * lev, sh.cz(q.u));
      body.extraCaps.push(Object.assign(mkCap(pt(sec[i]), pt(sec[i + 1]), sec[i].r, sec[i + 1].r), { foot: true }));
    }
  }
  grp.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  return grp;
}

export function buildAccessory(acc, body, mats3, sim) {
  const p = acc.p;
  const grp = new THREE.Group();
  const leather = mats3.leather, metal = mats3.metal(acc.metal);
  if (acc.type === 'shoes') {
    for (const leg of body.legs) grp.add(buildShoe(body, leg, p, leather, mats3.sole));
  } else if (acc.type === 'belt') {
    const N = 64, rings = [];
    for (const dy of [-p.w / 2, p.w / 2]) {
      for (const off of [1.6 + p.slack, 2.0 + p.slack]) {
        const r = body.ring(p.y + dy), ring = [];
        for (let k = 0; k < N; k++) {
          const th = (k / N) * Math.PI * 2, s = Math.sin(th), c = Math.cos(th), e = 2 / 2.35;
          const x = (r.a + off) * Math.sign(s) * Math.abs(s) ** e, z = ((c >= 0 ? r.bF : r.bB) + off) * Math.sign(c) * Math.abs(c) ** e + r.zc;
          ring.push(V(x, p.y + dy, z));
        }
        rings.push(ring);
      }
    }
    // order: bottom-inner, bottom-outer, top-inner, top-outer → make band: inner-bottom → outer-bottom → outer-top → inner-top → close
    const band = loftGeom([rings[0], rings[1], rings[3], rings[2], rings[0]], false, false);
    grp.add(new THREE.Mesh(band, leather));
    if (p.buckle) {
      const r = body.ring(p.y);
      const bk = new THREE.Mesh(new THREE.TorusGeometry(p.w * 0.55, 0.28, 8, 4), metal);
      bk.rotation.z = Math.PI / 4; bk.scale.set(1.25, 1, 1);
      bk.position.set(0, p.y, r.bF + 2.3 + p.slack + r.zc);
      grp.add(bk);
    }
    if (p.cinch && sim) sim.belts.push({ y: p.y, hw: p.w / 2 + 0.3, slack: 1.0 + p.slack, layer: 99 });
  } else if (acc.type === 'chain') {
    const pts = [];
    const n = 160;
    const o = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2;
      let y, R;
      if (p.at === 'neck') { y = body.m.y.neckBase + 0.5 - p.sag * ((Math.cos(th) + 1) / 2) ** 2; R = body.m.neck / (2 * Math.PI) + 2.5; }
      else { y = body.m.y.waist - 6 - p.sag * ((Math.cos(th - Math.PI / 2) + 1) / 2) ** 3 * 0.6; R = 0; }
      const r = body.ring(y);
      let x = (R || r.a + 2.5) * Math.sin(th), z = (R || Math.max(r.bF, r.bB) + 2.5) * Math.cos(th) + r.zc;
      for (let it = 0; it < 6; it++) { const d = body.sdf(x, y, z, o); if (d < 1.6) { x += o[0] * (1.6 - d); y += o[1] * (1.6 - d); z += o[2] * (1.6 - d); } }
      pts.push(V(x, y, z));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const len = curve.getLength(), links = Math.floor(len / (p.link * 0.85));
    const geo = new THREE.TorusGeometry(p.link * 0.5, p.link * 0.12, 6, 12);
    const inst = new THREE.InstancedMesh(geo, metal, links);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = V(0, 0, 1);
    for (let i = 0; i < links; i++) {
      const t = i / links, pos = curve.getPointAt(t), tan = curve.getTangentAt(t);
      q.setFromUnitVectors(V(1, 0, 0), tan);
      const tw = new THREE.Quaternion().setFromAxisAngle(tan, i % 2 ? Math.PI / 2 : 0);
      q.premultiply(tw);
      m4.compose(pos, q, V(1, 1, 1));
      inst.setMatrixAt(i, m4);
    }
    void up;
    grp.add(inst);
  } else if (acc.type === 'bag') {
    const sgn = p.side === 'L' ? 1 : -1;
    const r = body.ring(body.m.y.hip + 6);
    const bx = sgn * (r.a + p.d / 2 + 2.5), by = body.m.y.hip + 4;
    const box = new THREE.Mesh(new THREE.BoxGeometry(p.d, p.h, p.w, 2, 2, 2), leather);
    box.position.set(bx, by, 0);
    grp.add(box);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(p.d + 0.4, p.h * 0.45, p.w + 0.4), leather);
    flap.position.set(bx, by + p.h * 0.3, 0); grp.add(flap);
    // strap from opposite shoulder across chest
    const o = [0, 0, 0], path = [];
    const A = V(-sgn * body.m.shoulder * 0.28, body.m.y.shoulder + 3, -2), B = V(bx, by + p.h / 2, 0);
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, side = Math.sin(t * Math.PI);
      let x = lerp(A.x, B.x, t), y = lerp(A.y, B.y, t), z = lerp(-4, 0, t) + side * 14;
      for (let it = 0; it < 8; it++) { const d = body.sdf(x, y, z, o); if (d < 2.4) { x += o[0] * (2.4 - d); y += o[1] * (2.4 - d); z += o[2] * (2.4 - d); } }
      path.push(V(x, y, z));
    }
    const back = [];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      let x = lerp(A.x, B.x, t), y = lerp(A.y, B.y, t), z = -14 * Math.sin(t * Math.PI) - 2;
      for (let it = 0; it < 8; it++) { const d = body.sdf(x, y, z, o); if (d < 2.4) { x += o[0] * (2.4 - d); y += o[1] * (2.4 - d); z += o[2] * (2.4 - d); } }
      back.push(V(x, y, z));
    }
    for (const pp of [path, back]) {
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pp), 60, p.strap * 0.35, 6, false);
      const m = new THREE.Mesh(tube, leather); m.scale.set(1, 1, 1); grp.add(m);
    }
  } else if (acc.type === 'beanie') {
    const H = body.m.height, hc = body.m.y.headC + 0.5;
    const rx = 0.046 * H + 0.9, ry = 0.068 * H + 0.9, rz = 0.056 * H + 0.9;
    const rings = [];
    const N = 40;
    const y0 = hc + ry - p.depth - ry * 0.25;
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const y = lerp(y0, hc + ry + p.slouch * 0.6, t);
      const k = clamp((y - hc) / ry, -1, 1);
      let s = Math.sqrt(Math.max(0, 1 - k * k));
      if (y > hc + ry * 0.75) s = Math.max(s, 0.55 * (1 - t) + 0.12) * (1 + p.slouch * 0.02);
      const ring = [];
      for (let j = 0; j < N; j++) { const th = (j / N) * Math.PI * 2; ring.push(V(rx * s * Math.sin(th), y, rz * s * Math.cos(th) + 0.5 - (y - hc) * p.slouch * 0.03)); }
      rings.push(ring);
    }
    grp.add(new THREE.Mesh(loftGeom(rings, false, true), mats3.knit));
    if (p.cuff > 0) {
      const cuff = [];
      for (const [dy, off] of [[0, 0.3], [p.cuff, 0.6], [p.cuff, 1.1], [0, 0.9]]) {
        const y = y0 + dy, k = clamp((y - hc) / ry, -1, 1), s = Math.sqrt(Math.max(0, 1 - k * k));
        const ring = []; for (let j = 0; j < N; j++) { const th = (j / N) * Math.PI * 2; ring.push(V((rx * s + off) * Math.sin(th), y, (rz * s + off) * Math.cos(th) + 0.5)); }
        cuff.push(ring);
      }
      cuff.push(cuff[0]);
      grp.add(new THREE.Mesh(loftGeom(cuff, false, false), mats3.knit));
    }
  }
  grp.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  return grp;
}
