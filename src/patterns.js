// Pattern pieces: data model, drafting from body measurements, editing ops (corners, bends, cuts, seams)
import { uid, cubic, line, polyLen, resample, area, dist, clamp, lerp, catmull, inside, polyDist, segX, deep, bbox, centroid } from './util.js';

// ───────── model ─────────
// piece: { id, name, pts:[[x,y]], corners:[{i,id}], meta:{cornerId:{name,sa,raw,gather}}, mat, place:{kind,side,limb}, grain, view:{x,y}, sym,
//          prints:[], strokes:[], overlays:[], hardware:[] }
// seam:  { id, a:{p,e}, b:{p,e}, rev, name, order }

const SA_BY_NAME = { 'низ': 3, 'пояс': 3.5, 'горловина': 0.8, 'пройма': 0.8, 'борт': 1.5, 'низ рукава': 2.5 };

export function buildPiece(name, edges, opts = {}) {
  // edges: [{pts:[start…end], name, sa?, gather?}] CCW; consecutive edges share endpoints
  let E = edges.map((e) => ({ ...e, pts: densify(e.pts, 1.0) }));
  const poly = [];
  for (const e of E) poly.push(...e.pts.slice(0, -1));
  if (area(poly) < 0) E = E.slice().reverse().map((e) => ({ ...e, pts: e.pts.slice().reverse() }));
  const pts = [], corners = [], meta = {};
  for (const e of E) {
    const id = uid('c');
    corners.push({ i: pts.length, id });
    meta[id] = { name: e.name || '', sa: e.sa ?? SA_BY_NAME[e.name] ?? 1, raw: !!e.raw, gather: e.gather ?? 1 };
    pts.push(...e.pts.slice(0, -1).map((p) => [p[0], p[1]]));
    e.cid = id;
  }
  const piece = {
    id: uid('p'), name, pts, corners, meta, mat: opts.mat || null, place: opts.place || { kind: 'torso', side: 'front' },
    grain: 0, view: opts.view || { x: 0, y: 0 }, sym: opts.sym ?? true, prints: [], strokes: [], overlays: [], hardware: [],
  };
  piece._edgeIds = E.map((e) => e.cid);
  return piece;
}
function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]), n = Math.max(1, Math.ceil(d / step));
    for (let k = 1; k <= n; k++) out.push([lerp(pts[i - 1][0], pts[i][0], k / n), lerp(pts[i - 1][1], pts[i][1], k / n)]);
  }
  return out;
}

export const nEdges = (p) => p.corners.length;
export function edgeIdx(p, k) {
  const n = p.pts.length, a = p.corners[k].i, b = p.corners[(k + 1) % p.corners.length].i;
  const out = [];
  let i = a;
  for (let g = 0; g <= n; g++) { out.push(i); if (i === b && g > 0) break; i = (i + 1) % n; if (p.corners.length === 1 && i === a) { out.push(a); break; } }
  return out;
}
export const edgePts = (p, k) => edgeIdx(p, k).map((i) => p.pts[i]);
export const edgeLen = (p, k) => polyLen(edgePts(p, k));
export const edgeK = (p, cid) => p.corners.findIndex((c) => c.id === cid);
export const edgeMeta = (p, k) => p.meta[p.corners[k].id] || (p.meta[p.corners[k].id] = { name: '', sa: 1, raw: false, gather: 1 });
export function pieceArea(p) { return Math.abs(area(p.pts)); }

// ───────── seam allowance outline ─────────
export function cutOutline(p, scale = [1, 1]) {
  const n = p.corners.length, offs = [];
  const sc = (q) => [q[0] * scale[0], q[1] * scale[1]];
  for (let k = 0; k < n; k++) {
    const pts = edgePts(p, k).map(sc), m = edgeMeta(p, k);
    const d = m.raw ? 0 : m.sa;
    const o = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      o.push([pts[i][0] + (dy / l) * d, pts[i][1] - (dx / l) * d]);
    }
    offs.push({ o, d, corner: pts[0] });
  }
  const out = [];
  for (let k = 0; k < n; k++) {
    const prev = offs[(k - 1 + n) % n].o, cur = offs[k].o;
    const a1 = prev[prev.length - 2] || prev[0], a2 = prev[prev.length - 1], b1 = cur[0], b2 = cur[1] || cur[0];
    const X = lineX(a1, a2, b1, b2);
    const lim = 4 * Math.max(offs[k].d, offs[(k - 1 + n) % n].d, 0.3);
    if (X && dist(X, offs[k].corner) < lim) out.push(X);
    else { out.push(a2); out.push(b1); }
    for (let i = 1; i < cur.length - 1; i++) out.push(cur[i]);
  }
  return out;
}
function lineX(a, b, c, d) {
  const r0 = b[0] - a[0], r1 = b[1] - a[1], s0 = d[0] - c[0], s1 = d[1] - c[1];
  const den = r0 * s1 - r1 * s0;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s1 - (c[1] - a[1]) * s0) / den;
  return [a[0] + t * r0, a[1] + t * r1];
}

// ───────── drafting ─────────
export const GEN_PARAMS = {
  top: [
    ['ease', 'Свобода по груди', 0, 70, 1], ['len', 'Длина от плеча', 30, 150, 1], ['sleeve', 'Длина рукава (0 — без)', 0, 100, 1],
    ['drop', 'Спуск плеча', 0, 18, 0.5], ['bicep', 'Свобода рукава', 0, 30, 1], ['cuff', 'Ширина низа рукава +', 0, 40, 1],
    ['cuffEl', 'Манжета на резинке (0/1)', 0, 1, 1], ['neckW', 'Расширение горловины', -1, 12, 0.5], ['neckF', 'Глубина горловины переда', 2, 40, 0.5],
    ['neckB', 'Глубина горловины спинки', 1, 20, 0.5], ['armDrop', 'Углубление проймы', 0, 25, 0.5], ['hemCurve', 'Закругление низа', 0, 25, 0.5],
    ['asym', 'Асимметрия низа (лев/прав)', -45, 45, 1], ['flare', 'Расширение к низу', -6, 40, 0.5], ['waist', 'Прилегание по талии', 0, 10, 0.5],
    ['open', 'Распашной перед (0/1)', 0, 1, 1], ['overlap', 'Заход бортов', 0, 14, 0.5],
  ],
  pants: [
    ['ease', 'Свобода по бёдрам', 0, 50, 1], ['rise', 'Посадка талии ±', -12, 8, 0.5], ['drop', 'Заниженная мотня', 0, 45, 0.5],
    ['knee', 'Обхват у колена', 30, 90, 1], ['hem', 'Обхват низа', 24, 100, 1], ['len', 'Длина от талии', 30, 130, 1], ['elastic', 'Пояс на резинке (0/1)', 0, 1, 1],
  ],
  skirt: [
    ['ease', 'Свобода по бёдрам', 0, 40, 1], ['len', 'Длина от талии', 25, 130, 1], ['flare', 'Расширение к низу', 0, 60, 1], ['rise', 'Посадка ±', -10, 6, 0.5],
    ['asym', 'Асимметрия низа', -40, 40, 1], ['elastic', 'Пояс на резинке (0/1)', 0, 1, 1],
  ],
  snood: [['w', 'Длина полосы (обхват)', 40, 160, 1], ['h', 'Высота', 15, 80, 1], ['y', 'Положение (от основания шеи)', -10, 15, 0.5]],
};

export const GARMENT_PRESETS = [
  { id: 'tee', name: 'Футболка базовая', gen: 'top', layer: 1, mat: 'jer180', p: { ease: 10, len: 70, sleeve: 21, drop: 0, bicep: 6, cuff: 0, cuffEl: 0, neckW: 1, neckF: 8, neckB: 2, armDrop: 1, hemCurve: 0, asym: 0, flare: 1, waist: 0, open: 0, overlap: 0 } },
  { id: 'over', name: 'Футболка оверсайз', gen: 'top', layer: 1, mat: 'jer260', p: { ease: 30, len: 74, sleeve: 27, drop: 8, bicep: 12, cuff: 6, cuffEl: 0, neckW: 1.5, neckF: 8, neckB: 2, armDrop: 6, hemCurve: 0, asym: 0, flare: 0, waist: 0, open: 0, overlap: 0 } },
  { id: 'long', name: 'Лонгслив удлинённый, длинный рукав', gen: 'top', layer: 1, mat: 'vis180', p: { ease: 8, len: 92, sleeve: 76, drop: 0, bicep: 4, cuff: 0, cuffEl: 1, neckW: 2, neckF: 7, neckB: 2, armDrop: 1, hemCurve: 8, asym: 0, flare: 4, waist: 0, open: 0, overlap: 0 } },
  { id: 'tank', name: 'Майка с глубокой проймой', gen: 'top', layer: 1, mat: 'slub160', p: { ease: 8, len: 84, sleeve: 0, drop: -1, bicep: 0, cuff: 0, cuffEl: 0, neckW: 3, neckF: 14, neckB: 4, armDrop: 14, hemCurve: 4, asym: 0, flare: 4, waist: 0, open: 0, overlap: 0 } },
  { id: 'tunic', name: 'Туника с асимметричным низом', gen: 'top', layer: 1, mat: 'gau110', p: { ease: 26, len: 98, sleeve: 30, drop: 7, bicep: 10, cuff: 8, cuffEl: 0, neckW: 2, neckF: 10, neckB: 2.5, armDrop: 5, hemCurve: 4, asym: 26, flare: 10, waist: 0, open: 0, overlap: 0 } },
  { id: 'coat', name: 'Длинный распашной кардиган / пальто', gen: 'top', layer: 2, mat: 'boil450', p: { ease: 28, len: 112, sleeve: 66, drop: 5, bicep: 12, cuff: 8, cuffEl: 0, neckW: 2, neckF: 26, neckB: 2.5, armDrop: 6, hemCurve: 0, asym: 0, flare: 8, waist: 0, open: 1, overlap: 2 } },
  { id: 'trou', name: 'Брюки прямые', gen: 'pants', layer: 0, mat: 'gab260', p: { ease: 8, rise: 0, drop: 0, knee: 46, hem: 42, len: 102, elastic: 0 } },
  { id: 'dropc', name: 'Брюки с заниженной мотнёй', gen: 'pants', layer: 0, mat: 'jer260', p: { ease: 18, rise: -2, drop: 26, knee: 50, hem: 30, len: 108, elastic: 1 } },
  { id: 'skirt', name: 'Юбка длинная, расклешённая', gen: 'skirt', layer: 0, mat: 'lin185', p: { ease: 6, len: 88, flare: 18, rise: 0, asym: 0, elastic: 0 } },
  { id: 'snood', name: 'Снуд / хомут', gen: 'snood', layer: 3, mat: 'mohk', p: { w: 92, h: 42, y: 2 } },
];

const mirrorEdges = (edges) => edges.slice().reverse().map((e) => ({ ...e, pts: e.pts.slice().reverse().map(([x, y]) => [-x, y]) }));

function topBody(M, p, kind) {
  // kind: 'front' | 'back'
  const sx0 = M.shoulder / 2 + 0.8;
  const drop = Math.max(-2, p.drop);
  const yS = M.y.shoulder + 0.6;
  const nw = M.neck / (2 * Math.PI) * 1.18 + p.neckW;
  const yNB = yS + Math.max(2.5, (sx0 - nw) * 0.3);
  const sx = sx0 + drop;
  const ys = yS - drop * 0.22;
  let fw = (M.chest + p.ease) / 4;
  const ya = Math.min(ys - 9, M.y.armpit - 1.5 - p.armDrop - p.ease * 0.06 - drop * 0.35);
  fw = Math.max(fw, sx - 1);
  const yHem = yNB - p.len;
  const hw = Math.max(fw * 0.6, fw + p.flare);
  const dF = kind === 'front' ? p.neckF : p.neckB;
  const sgn = kind === 'front' ? 1 : -1;
  const hemY = (x) => yHem + p.hemCurve * (x / hw) ** 2 - sgn * p.asym * (x / hw) * 0.5;
  const yW = M.y.waist;
  const sideMid = (s) => {
    const t = clamp((ya - yW) / Math.max(1, ya - yHem), 0.05, 0.95);
    return [s * (lerp(fw, hw, t) - p.waist), yW];
  };
  const hemPts = []; for (let i = 0; i <= 20; i++) { const x = lerp(-hw, hw, i / 20); hemPts.push([x, hemY(x)]); }
  const side = (s) => {
    const a = [s * hw, hemY(s * hw)], b = [s * fw, ya];
    if (yW < ya - 3 && yW > yHem + 3 && p.waist > 0) return catmull([a, sideMid(s), b], 10);
    return [a, b];
  };
  const arm = (s) => cubic([s * fw, ya], [s * (fw - (fw - sx) * 0.55 - 0.6), ya + 0.2], [s * (sx - (kind === 'front' ? 1.0 : 0.4)), ya + (ys - ya) * 0.48], [s * sx, ys], 16);
  const neckHalf = (s) => cubic([s * nw, yNB], [s * nw, yNB - dF * 0.62], [s * nw * 0.55, yNB - dF], [0, yNB - dF], 12);
  return { sx, ys, nw, yNB, fw, ya, hw, hemY, hemPts, side, arm, neckHalf, dF, yHem };
}

export function genTop(M, p) {
  const pieces = [], seams = [];
  const F = topBody(M, p, 'front'), B = topBody(M, p, 'back');
  const shoulder = (G, s) => line([s * G.sx, G.ys], [s * G.nw, G.yNB], 1);
  const sleeveless = p.sleeve <= 0;
  const armName = sleeveless ? 'пройма' : 'пройма';
  const edgesFull = (G) => [
    { pts: G.hemPts, name: 'низ' },
    { pts: G.side(1), name: 'бок' },
    { pts: G.arm(1), name: armName, sa: sleeveless ? 0.8 : 1 },
    { pts: shoulder(G, 1), name: 'плечо' },
    { pts: [...G.neckHalf(1), ...G.neckHalf(-1).reverse().slice(1)], name: 'горловина' },
    { pts: shoulder(G, -1).reverse(), name: 'плечо' },
    { pts: G.arm(-1).reverse(), name: armName, sa: sleeveless ? 0.8 : 1 },
    { pts: G.side(-1).reverse(), name: 'бок' },
  ];
  // back
  const back = buildPiece('Спинка', edgesFull(B), { place: { kind: 'torso', side: 'back' }, view: { x: B.hw * 2 + 12, y: 0 } });
  const bE = back._edgeIds; // 0 hem,1 sideR,2 armR,3 shR,4 neck,5 shL,6 armL,7 sideL
  let frontParts;
  if (!p.open) {
    const front = buildPiece('Перед', edgesFull(F), { place: { kind: 'torso', side: 'front' }, view: { x: 0, y: 0 } });
    pieces.push(front, back);
    const fE = front._edgeIds;
    frontParts = { L: { piece: front, side: fE[1], arm: fE[2], sh: fE[3] }, R: { piece: front, side: fE[7], arm: fE[6], sh: fE[5] } };
  } else {
    const ov = p.overlap;
    // model-left front: from centre front (x = -ov) to side (+x)
    const neckL = F.neckHalf(1); // from SNP to CF (0, yNB-dF)
    const cfTop = [-ov, F.yNB - F.dF], cfBot = [-ov, F.hemY(-ov)];
    const hem = []; for (let i = 0; i <= 14; i++) { const x = lerp(-ov, F.hw, i / 14); hem.push([x, F.hemY(x)]); }
    const edgesL = [
      { pts: hem, name: 'низ' },
      { pts: F.side(1), name: 'бок' },
      { pts: F.arm(1), name: 'пройма' },
      { pts: shoulder(F, 1), name: 'плечо' },
      { pts: ov > 0 ? [...neckL, cfTop] : neckL, name: 'горловина' },
      { pts: [cfTop, cfBot], name: 'борт' },
    ];
    const fl = buildPiece('Полочка левая', edgesL, { place: { kind: 'torso', side: 'front' }, view: { x: 4, y: 0 }, sym: false });
    const fr = buildPiece('Полочка правая', mirrorEdges(edgesL), { place: { kind: 'torso', side: 'front' }, view: { x: -4, y: 0 }, sym: false });
    pieces.push(fl, fr, back);
    const lE = fl._edgeIds, rE = fr._edgeIds; // mirrored order reversed: rE = [борт, горловина, плечо, пройма, бок, низ]
    frontParts = { L: { piece: fl, side: lE[1], arm: lE[2], sh: lE[3] }, R: { piece: fr, side: rE[4], arm: rE[3], sh: rE[2] } };
  }
  const S = (a, b, name, order) => seams.push({ id: uid('s'), a, b, rev: null, name, order });
  // model's left = front +x / back −x
  S({ p: frontParts.L.piece.id, e: frontParts.L.sh }, { p: back.id, e: bE[5] }, 'Плечевой шов (лев.)', 1);
  S({ p: frontParts.R.piece.id, e: frontParts.R.sh }, { p: back.id, e: bE[3] }, 'Плечевой шов (прав.)', 1);
  if (!sleeveless) {
    const sl = genSleeve(M, p, edgeLenOf(frontParts.L.piece, frontParts.L.arm), edgeLenOf(back, bE[6]));
    for (const [arm, fp, bArm, vx] of [['L', frontParts.L, bE[6], -1], ['R', frontParts.R, bE[2], 1]]) {
      const s = buildPiece(arm === 'L' ? 'Рукав левый' : 'Рукав правый', sl.edges, { place: { kind: 'arm', limb: arm }, view: { x: vx < 0 ? -(F.hw + sl.B / 2 + 10) : B.hw * 3 + sl.B / 2 + 22, y: F.ys }, sym: true });
      const e = s._edgeIds; // 0 cuff,1 seamR,2 capF,3 capB,4 seamL
      if (p.cuffEl) s.meta[e[0]].gather = clamp((M.wrist + 7) / sl.cw, 0.45, 1);
      pieces.push(s);
      S({ p: s.id, e: e[2] }, { p: fp.piece.id, e: fp.arm }, `Втачивание рукава, перед (${arm === 'L' ? 'лев.' : 'прав.'})`, 3);
      S({ p: s.id, e: e[3] }, { p: back.id, e: bArm }, `Втачивание рукава, спинка (${arm === 'L' ? 'лев.' : 'прав.'})`, 3);
      S({ p: s.id, e: e[1] }, { p: s.id, e: e[4] }, `Шов рукава (${arm === 'L' ? 'лев.' : 'прав.'})`, 4);
    }
  }
  S({ p: frontParts.L.piece.id, e: frontParts.L.side }, { p: back.id, e: bE[7] }, 'Боковой шов (лев.)', sleeveless ? 2 : 4);
  S({ p: frontParts.R.piece.id, e: frontParts.R.side }, { p: back.id, e: bE[1] }, 'Боковой шов (прав.)', sleeveless ? 2 : 4);
  return { pieces, seams };
}
function edgeLenOf(piece, cid) { return edgeLen(piece, edgeK(piece, cid)); }

function genSleeve(M, p, ahF, ahB) {
  let B = M.upperArm + 4 + p.bicep;
  const capF = (B, ch) => cubic([B / 2, -ch], [B * 0.31, -ch * 0.78], [B * 0.17, -ch * 0.02], [0, 0], 14);
  const capB = (B, ch) => cubic([0, 0], [-B * 0.19, -ch * 0.02], [-B * 0.33, -ch * 0.8], [-B / 2, -ch], 14);
  const target = ahF + 0.3;
  for (let g = 0; g < 30 && polyLen(capF(B, 0.5)) > target; g++) B *= 0.96;
  let lo = 0.5, hi = 30;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (polyLen(capF(B, mid)) < target) lo = mid; else hi = mid; }
  const ch = lo;
  const L = Math.max(p.sleeve, ch + 4);
  const armL = M.armLen - p.drop * 0.9;
  const t = clamp((L - ch) / Math.max(1, armL - ch), 0, 1);
  let cw = lerp(B, M.wrist + 5, t) + p.cuff;
  cw = Math.min(cw, B + p.cuff);
  const bottom = -L;
  const edges = [
    { pts: [[-cw / 2, bottom], [cw / 2, bottom]], name: 'низ рукава' },
    { pts: [[cw / 2, bottom], [B / 2, -ch]], name: 'шов рукава' },
    { pts: capF(B, ch), name: 'окат (перед)' },
    { pts: capB(B, ch), name: 'окат (спинка)' },
    { pts: [[-B / 2, -ch], [-cw / 2, bottom]], name: 'шов рукава' },
  ];
  return { edges, B, ch, cw };
}

export function genPants(M, p) {
  const pieces = [], seams = [];
  const drop = clamp(p.drop, 0, Math.max(0, M.y.crotch - M.y.knee - 10 + 25));
  const yW = M.y.waist + p.rise, yH = M.y.hip;
  const yC = Math.max(M.y.ankle + 15, M.y.crotch - 1.5 - drop);
  const yK = M.y.knee;
  const yHem = Math.max(0.8, yW - p.len);
  const Hg = M.hips + p.ease;
  const Fh = Hg / 4 - 1, Bh = Hg / 4 + 1;
  const Fe = Hg / 20 + drop * 0.18, Be = Hg / 10 + drop * 0.28;
  const useKnee = yC > yK + 10 && yHem < yK - 6;
  const build = (isBack) => {
    const Hw = isBack ? Bh : Fh, Ex = isBack ? Be : Fe;
    const W1 = Hw + Ex;
    const cf = -W1 / 2 + Ex;
    const side = W1 / 2;
    const kw = (p.knee / 2 + (isBack ? 1 : -1)) / 2, hw = (p.hem / 2 + (isBack ? 1 : -1)) / 2;
    const waistW = p.elastic ? Hw - 0.5 : (M.waist + 1) / 4 + (isBack ? 0.9 : 0.4);
    const cfW = cf + (isBack ? 2.4 : 0.8);
    const yWc = yW + (isBack ? 2.5 : 0);
    const sideW = Math.min(side, cfW + waistW);
    const hem = [[-hw, yHem], [hw, yHem]];
    const sideEdge = useKnee
      ? catmull([[hw, yHem], [kw, yK], [side, yC], [side, Math.max(yH, yC + 2)], [sideW, yW]], 8)
      : catmull([[hw, yHem], [side, yC], [side, Math.max(yH, yC + 2)], [sideW, yW]], 8);
    const waist = line([sideW, yW], [cfW, yWc], 6);
    const cy0 = yC + Math.max(3, (yH - yC) * 0.85);
    const crotch = [[cfW, yWc], ...cubic([cf, cy0], [cf - (isBack ? 0.4 : 0), yC + (isBack ? 1.2 : 2.4)], [cf - Ex * (isBack ? 0.62 : 0.45), yC - (isBack ? 0.5 : 0)], [-W1 / 2, yC - (isBack ? 1 : 0)], 14)];
    const crotchPt = crotch[crotch.length - 1];
    const inseam = useKnee ? catmull([crotchPt, [-kw, yK], [-hw, yHem]], 10) : [crotchPt, [-hw, yHem]];
    return [
      { pts: hem, name: 'низ' }, { pts: sideEdge, name: 'бок' }, { pts: waist, name: 'пояс', gather: p.elastic ? clamp((M.waist + 6) / (2 * Hg / 2 + 2), 0.4, 1) * 1.0 : 1 },
      { pts: crotch, name: 'средний шов' }, { pts: inseam, name: 'шаговый шов' },
    ];
  };
  const fL = build(false), bL = build(true);
  // elastic: gather ratio of total waist
  const fLp = buildPiece('Передняя половинка (лев.)', fL, { place: { kind: 'leg', limb: 'L', side: 'front' }, view: { x: 30, y: 0 }, sym: false });
  const fRp = buildPiece('Передняя половинка (прав.)', mirrorEdges(fL), { place: { kind: 'leg', limb: 'R', side: 'front' }, view: { x: -6, y: 0 }, sym: false });
  const bLp = buildPiece('Задняя половинка (лев.)', mirrorEdges(bL), { place: { kind: 'leg', limb: 'L', side: 'back' }, view: { x: 68, y: 0 }, sym: false });
  const bRp = buildPiece('Задняя половинка (прав.)', bL, { place: { kind: 'leg', limb: 'R', side: 'back' }, view: { x: 110, y: 0 }, sym: false });
  pieces.push(fRp, fLp, bLp, bRp);
  const id = (pc, nm) => pc.corners.find((c) => pc.meta[c.id].name === nm).id;
  const S = (a, b, name, order) => seams.push({ id: uid('s'), a, b, rev: null, name, order });
  S({ p: fLp.id, e: id(fLp, 'средний шов') }, { p: fRp.id, e: id(fRp, 'средний шов') }, 'Средний шов переда', 1);
  S({ p: bLp.id, e: id(bLp, 'средний шов') }, { p: bRp.id, e: id(bRp, 'средний шов') }, 'Средний шов спинки', 1);
  S({ p: fLp.id, e: id(fLp, 'бок') }, { p: bLp.id, e: id(bLp, 'бок') }, 'Боковой шов (лев.)', 2);
  S({ p: fRp.id, e: id(fRp, 'бок') }, { p: bRp.id, e: id(bRp, 'бок') }, 'Боковой шов (прав.)', 2);
  S({ p: fLp.id, e: id(fLp, 'шаговый шов') }, { p: bLp.id, e: id(bLp, 'шаговый шов') }, 'Шаговый шов (лев.)', 3);
  S({ p: fRp.id, e: id(fRp, 'шаговый шов') }, { p: bRp.id, e: id(bRp, 'шаговый шов') }, 'Шаговый шов (прав.)', 3);
  return { pieces, seams };
}

export function genSkirt(M, p) {
  const yW = M.y.waist + p.rise, yH = M.y.hip, yHem = Math.max(1, yW - p.len);
  const Hg = M.hips + p.ease;
  const hipHalf = Hg / 4;
  const ww = p.elastic ? hipHalf + 0.5 : (M.waist + 2) / 4 + 0.6;
  const mk = (kind) => {
    const sgn = kind === 'front' ? 1 : -1;
    const hw = hipHalf + p.flare;
    const hemY = (x) => yHem + Math.abs(x / hw) ** 2 * p.flare * 0.12 - sgn * p.asym * (x / hw) * 0.5;
    const hem = []; for (let i = 0; i <= 20; i++) { const x = lerp(-hw, hw, i / 20); hem.push([x, hemY(x)]); }
    const sideR = catmull([[hw, hemY(hw)], [hipHalf + p.flare * clamp((yH - yHem) / (yW - yHem), 0, 1) * 0.25 + 0.01, yH], [ww, yW]], 10);
    const waist = []; for (let i = 0; i <= 12; i++) { const x = lerp(ww, -ww, i / 12); waist.push([x, yW - 0.8 * (1 - (x / ww) ** 2) * (kind === 'front' ? 1 : -0.3)]); }
    const sideL = sideR.slice().reverse().map(([x, y]) => [-x, y]);
    return buildPiece(kind === 'front' ? 'Перед юбки' : 'Спинка юбки', [
      { pts: hem, name: 'низ' }, { pts: sideR, name: 'бок' }, { pts: waist, name: 'пояс', gather: p.elastic ? clamp((M.waist + 5) / (4 * ww), 0.4, 1) : 1 }, { pts: sideL, name: 'бок' },
    ], { place: { kind: 'torso', side: kind }, view: { x: kind === 'front' ? 0 : hw * 2 + 10, y: 0 } });
  };
  const f = mk('front'), b = mk('back');
  const fe = f._edgeIds, be = b._edgeIds;
  return {
    pieces: [f, b],
    seams: [
      { id: uid('s'), a: { p: f.id, e: fe[1] }, b: { p: b.id, e: be[3] }, rev: null, name: 'Боковой шов (лев.)', order: 1 },
      { id: uid('s'), a: { p: f.id, e: fe[3] }, b: { p: b.id, e: be[1] }, rev: null, name: 'Боковой шов (прав.)', order: 1 },
    ],
  };
}

export function genSnood(M, p) {
  const y0 = M.y.neckBase + p.y - p.h * 0.62;
  const w = p.w, h = p.h;
  const s = buildPiece('Снуд', [
    { pts: [[-w / 2, y0], [w / 2, y0]], name: 'край', sa: 1 }, { pts: [[w / 2, y0], [w / 2, y0 + h]], name: 'шов' },
    { pts: [[w / 2, y0 + h], [-w / 2, y0 + h]], name: 'край', sa: 1 }, { pts: [[-w / 2, y0 + h], [-w / 2, y0]], name: 'шов' },
  ], { place: { kind: 'neck' }, view: { x: 0, y: 0 } });
  const e = s._edgeIds;
  return { pieces: [s], seams: [{ id: uid('s'), a: { p: s.id, e: e[1] }, b: { p: s.id, e: e[3] }, rev: null, name: 'Соединить в кольцо', order: 1 }] };
}

export const GENERATORS = { top: genTop, pants: genPants, skirt: genSkirt, snood: genSnood };

// ───────── editing ops ─────────
export function findPiece(G, id) { for (const g of G) { const p = g.pieces.find((x) => x.id === id); if (p) return { g, p }; } return null; }
export function seamOf(g, pid, cid) { return g.seams.find((s) => (s.a.p === pid && s.a.e === cid) || (s.b.p === pid && s.b.e === cid)); }

// insert a corner on edge k at arc fraction f; returns new corner id. Splits a seam on that edge (and its partner) consistently.
export function splitEdge(g, piece, k, f, propagate = true) {
  const cid = piece.corners[k].id;
  const idx = edgeIdx(piece, k), pts = idx.map((i) => piece.pts[i]);
  const L = polyLen(pts), target = L * clamp(f, 0.001, 0.999);
  let acc = 0, seg = 0;
  for (; seg < pts.length - 1; seg++) { const d = dist(pts[seg], pts[seg + 1]); if (acc + d >= target) break; acc += d; }
  seg = Math.min(seg, pts.length - 2);
  const d = dist(pts[seg], pts[seg + 1]), t = d > 0 ? (target - acc) / d : 0;
  let newI;
  const snap = 0.15;
  if (t * d < snap && seg > 0) newI = idx[seg];
  else if ((1 - t) * d < snap && seg + 1 < pts.length - 1) newI = idx[seg + 1];
  else {
    const np = [lerp(pts[seg][0], pts[seg + 1][0], t), lerp(pts[seg][1], pts[seg + 1][1], t)];
    const at = idx[seg + 1] === 0 ? piece.pts.length : idx[seg + 1];
    piece.pts.splice(at, 0, np);
    for (const c of piece.corners) if (c.i >= at) c.i++;
    newI = at;
  }
  const nid = uid('c');
  // insert corner after k (respecting index order)
  piece.corners.splice(k + 1, 0, { i: newI, id: nid });
  sortCorners(piece);
  piece.meta[nid] = { ...piece.meta[cid] };
  if (propagate) {
    const s = seamOf(g, piece.id, cid);
    if (s) {
      const mine = s.a.p === piece.id && s.a.e === cid ? 'a' : 'b';
      const other = mine === 'a' ? s.b : s.a;
      const op = g.pieces.find((x) => x.id === other.p);
      const ok = edgeK(op, other.e);
      const fo = s.rev ? 1 - f : f;
      const onid = splitEdge(g, op, ok, fo, false);
      const me1 = { p: piece.id, e: cid }, me2 = { p: piece.id, e: nid };
      const ot1 = { p: op.id, e: other.e }, ot2 = { p: op.id, e: onid };
      g.seams = g.seams.filter((x) => x !== s);
      const pairs = s.rev ? [[me1, ot2], [me2, ot1]] : [[me1, ot1], [me2, ot2]];
      for (const [a, b] of pairs) g.seams.push({ id: uid('s'), a, b, rev: s.rev, name: s.name, order: s.order });
    }
  }
  return nid;
}
function sortCorners(p) {
  // keep corners in polygon order starting from the corner with lowest index, preserve cyclic order
  p.corners.sort((a, b) => a.i - b.i);
}

export function removeCorner(g, piece, k) {
  if (piece.corners.length <= 3) return false;
  const c = piece.corners[k], prev = piece.corners[(k - 1 + piece.corners.length) % piece.corners.length];
  g.seams = g.seams.filter((s) => !((s.a.p === piece.id && (s.a.e === c.id || s.a.e === prev.id)) || (s.b.p === piece.id && (s.b.e === c.id || s.b.e === prev.id))));
  piece.corners.splice(k, 1);
  delete piece.meta[c.id];
  return true;
}

// cut a piece along a polyline; returns {A,B} or {error}
export function cutPiece(g, piece, path) {
  const poly = piece.pts, n = poly.length;
  const hits = [];
  for (let s = 0; s < path.length - 1; s++)
    for (let i = 0; i < n; i++) {
      const x = segX(path[s], path[s + 1], poly[i], poly[(i + 1) % n]);
      if (x) hits.push({ s, t: x.t, pt: x.pt, key: s + x.t });
    }
  hits.sort((a, b) => a.key - b.key);
  const uniq = [];
  for (const h of hits) if (!uniq.length || dist(uniq[uniq.length - 1].pt, h.pt) > 0.5) uniq.push(h);
  if (uniq.length < 2) return { error: 'Линия разреза должна пересечь деталь от края до края' };
  const h1 = uniq[0], h2 = uniq[1];
  // interior path between hits
  const inner = [h1.pt];
  for (let s = h1.s + 1; s <= h2.s; s++) inner.push(path[s]);
  inner.push(h2.pt);
  const mid = inner[Math.floor(inner.length / 2)];
  const cutLine = resample(inner, Math.max(2, Math.ceil(polyLen(inner) / 1.0)));
  if (polyLen(cutLine) < 1) return { error: 'Слишком короткий разрез' };
  // make corners at both hit points
  const cornerAt = (pt) => {
    const near = piece.corners.find((c) => dist(piece.pts[c.i], pt) < 0.6);
    if (near) return near.id;
    const r = polyDist(pt, piece.pts);
    // which edge contains segment r.seg
    let k = 0;
    for (let j = 0; j < piece.corners.length; j++) { const ids = edgeIdx(piece, j); if (ids.slice(0, -1).includes(r.seg)) { k = j; break; } }
    const ids = edgeIdx(piece, k), epts = ids.map((i) => piece.pts[i]);
    let acc = 0; for (let j = 0; j < ids.length - 1; j++) { if (ids[j] === r.seg) { acc += dist(epts[j], epts[j + 1]) * r.t; break; } acc += dist(epts[j], epts[j + 1]); }
    return splitEdge(g, piece, k, acc / polyLen(epts));
  };
  const c1 = cornerAt(h1.pt), c2 = cornerAt(h2.pt);
  if (c1 === c2) return { error: 'Разрез попал в одну точку' };
  const ci = (id) => piece.corners.find((c) => c.id === id).i;
  const i1 = ci(c1), i2 = ci(c2), N = piece.pts.length;
  const walk = (a, b) => { const o = []; let i = a; for (;;) { o.push(i); if (i === b) break; i = (i + 1) % N; } return o; };
  const w12 = walk(i1, i2), w21 = walk(i2, i1);
  const cutIn = cutLine.slice(1, -1);
  const ptsA = [...w12.map((i) => piece.pts[i]), ...cutIn.slice().reverse()];
  const ptsB = [...w21.map((i) => piece.pts[i]), ...cutIn];
  // corners
  const cornersIn = (w) => piece.corners.filter((c) => w.includes(c.i)).map((c) => ({ id: c.id, i: w.indexOf(c.i) })).sort((a, b) => a.i - b.i);
  const cA = cornersIn(w12), cB = cornersIn(w21);
  const old = deep(piece);
  // edges whose start corner is in A-range (excluding c2, which now starts the cut) stay with A; edges starting in B-range (excluding c1) go to B
  const Bp = { ...deep(old), id: uid('p'), name: old.name + ' · часть', pts: ptsB, corners: cB, srcId: old.id };
  piece.pts = ptsA; piece.corners = cA; piece.srcId = old.id;
  const metaA = {}, metaB = {};
  for (const c of cA) metaA[c.id] = c.id === c2 ? { name: 'рельеф', sa: 1, raw: false, gather: 1 } : { ...old.meta[c.id] };
  for (const c of cB) metaB[c.id] = c.id === c1 ? { name: 'рельеф', sa: 1, raw: false, gather: 1 } : { ...old.meta[c.id] };
  piece.meta = metaA; Bp.meta = metaB;
  // assign decorations by position
  for (const key of ['prints', 'overlays', 'hardware', 'strokes']) {
    const all = old[key] || [];
    piece[key] = []; Bp[key] = [];
    for (const it of all) {
      const at = key === 'overlays' ? centroid(it.pts) : key === 'strokes' ? it.pts[0] : [it.x, it.y];
      (inside(at, ptsB) ? Bp[key] : piece[key]).push(it);
    }
  }
  // remap seams
  for (const s of g.seams) for (const side of ['a', 'b']) {
    const r = s[side];
    if (r.p !== old.id) continue;
    const inB = cB.some((c) => c.id === r.e) && r.e !== c1;
    const inA = cA.some((c) => c.id === r.e) && r.e !== c2;
    if (inB && !inA) r.p = Bp.id;
    else if (r.e === c2) r.p = Bp.id; // original edge starting at c2 lies in B
  }
  g.pieces.splice(g.pieces.indexOf(piece) + 1, 0, Bp);
  g.seams.push({ id: uid('s'), a: { p: piece.id, e: c2 }, b: { p: Bp.id, e: c1 }, rev: true, name: 'Шов членения: ' + old.name, order: 0 });
  return { A: piece, B: Bp };
}

export function duplicatePiece(g, piece, mirror) {
  const c = deep(piece);
  c.id = uid('p');
  c.name = piece.name + (mirror ? ' (зерк.)' : ' (копия)');
  const map = {};
  for (const k of c.corners) { const nid = uid('c'); map[k.id] = nid; }
  c.corners = c.corners.map((k) => ({ i: k.i, id: map[k.id] }));
  const meta = {}; for (const k in piece.meta) if (map[k]) meta[map[k]] = { ...piece.meta[k] };
  c.meta = meta;
  if (mirror) {
    // mirror x and reverse orientation: polygon reversed
    const n = c.pts.length;
    const oldEdges = piece.corners.map((_, k) => ({ pts: edgePts(piece, k).map(([x, y]) => [-x, y]).reverse(), m: piece.meta[piece.corners[k].id] }));
    const re = oldEdges.slice().reverse();
    const tmp = buildPiece(c.name, re.map((e) => ({ pts: e.pts, name: e.m.name, sa: e.m.sa, raw: e.m.raw, gather: e.m.gather })), { place: c.place, view: { ...c.view } });
    c.pts = tmp.pts; c.corners = tmp.corners; c.meta = tmp.meta;
    c.prints = c.prints.map((p) => ({ ...p, x: -p.x, rot: -(p.rot || 0) }));
    c.overlays = c.overlays.map((o) => ({ ...o, pts: o.pts.map(([x, y]) => [-x, y]).reverse() }));
    c.hardware = c.hardware.map((h) => ({ ...h, x: -h.x }));
    c.strokes = c.strokes.map((s) => ({ ...s, pts: s.pts.map(([x, y]) => [-x, y]) }));
    void n;
  }
  c.view = { x: piece.view.x + bbox(piece.pts).w + 8, y: piece.view.y };
  if (mirror) c.baseMirror = !piece.baseMirror;
  delete c.srcId;
  g.pieces.push(c);
  return c;
}

// deformation for interactive drag: returns new pts from base
export function deformCorner(base, piece, k, dx, dy) {
  const pts = base.map((p) => [...p]);
  const n = piece.corners.length;
  const apply = (edgeK, atStart) => {
    const ids = edgeIdx(piece, edgeK), ep = ids.map((i) => base[i]);
    const L = polyLen(ep); let acc = 0;
    for (let j = 0; j < ids.length; j++) {
      if (j > 0) acc += dist(ep[j - 1], ep[j]);
      const t = L > 0 ? acc / L : 0;
      const w = atStart ? 1 - t : t;
      if (w <= 0) continue;
      pts[ids[j]][0] = base[ids[j]][0] + dx * w;
      pts[ids[j]][1] = base[ids[j]][1] + dy * w;
    }
  };
  apply(k, true);
  apply((k - 1 + n) % n, false);
  return pts;
}
export function deformEdge(base, piece, k, dx, dy) {
  const pts = base.map((p) => [...p]);
  const ids = edgeIdx(piece, k), ep = ids.map((i) => base[i]);
  const L = polyLen(ep); let acc = 0;
  for (let j = 1; j < ids.length - 1; j++) {
    acc += dist(ep[j - 1], ep[j]);
    const w = Math.sin(Math.PI * (acc / L));
    pts[ids[j]][0] = base[ids[j]][0] + dx * w;
    pts[ids[j]][1] = base[ids[j]][1] + dy * w;
  }
  return pts;
}
export function mirrorCorner(piece, k) {
  const p = piece.pts[piece.corners[k].i];
  if (Math.abs(p[0]) < 0.3) return -1;
  for (let j = 0; j < piece.corners.length; j++) { const q = piece.pts[piece.corners[j].i]; if (j !== k && Math.abs(q[0] + p[0]) < 0.6 && Math.abs(q[1] - p[1]) < 0.6) return j; }
  return -1;
}
export function mirrorEdgeK(piece, k) {
  const e = edgePts(piece, k), m = e[Math.floor(e.length / 2)];
  for (let j = 0; j < piece.corners.length; j++) {
    if (j === k) continue;
    const f = edgePts(piece, j), q = f[Math.floor(f.length / 2)];
    if (Math.abs(q[0] + m[0]) < 0.8 && Math.abs(q[1] - m[1]) < 0.8) return j;
  }
  return -1;
}

export function seamLengths(g, s) {
  const pa = g.pieces.find((p) => p.id === s.a.p), pb = g.pieces.find((p) => p.id === s.b.p);
  if (!pa || !pb) return null;
  const ka = edgeK(pa, s.a.e), kb = edgeK(pb, s.b.e);
  if (ka < 0 || kb < 0) return null;
  const la = edgeLen(pa, ka) * (pa.meta[s.a.e]?.gather ?? 1), lb = edgeLen(pb, kb) * (pb.meta[s.b.e]?.gather ?? 1);
  return { la: edgeLen(pa, ka), lb: edgeLen(pb, kb), diff: la - lb, pa, pb, ka, kb };
}

export function sewingSteps(g) {
  const by = {};
  for (const s of g.seams) (by[s.order ?? 9] ||= []).push(s);
  const keys = Object.keys(by).map(Number).sort((a, b) => a - b);
  const steps = [];
  const labels = { 0: 'Соединить детали членения (рельефы, вставки)', 1: 'Плечевые / средние швы', 2: 'Боковые швы', 3: 'Втачать рукава / шаговые швы', 4: 'Швы рукавов и боковые швы', 9: 'Пользовательские швы' };
  for (const k of keys) steps.push({ title: labels[k] || 'Швы', seams: by[k] });
  return steps;
}
