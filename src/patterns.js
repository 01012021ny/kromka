// @ts-check
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
  const pts = [], corners = [], meta = {}, tags = {};
  for (const e of E) {
    const id = uid('c');
    corners.push({ i: pts.length, id });
    meta[id] = { name: e.name || '', sa: e.sa ?? SA_BY_NAME[e.name] ?? 1, raw: !!e.raw, gather: e.gather ?? 1 };
    if (e.lap) meta[id].lap = e.lap; // заход застёжки: в обхват готовой вещи не входит
    if (e.fold) meta[id].fold = true; // сторона — линия сгиба (припуск = обтачка, cut-on facing)
    pts.push(...e.pts.slice(0, -1).map((p) => [p[0], p[1]]));
    e.cid = id;
    if (e.tag) (tags[e.tag] = id);
  }
  const piece = {
    id: uid('p'), name, pts, corners, meta, mat: opts.mat || null, place: opts.place || { kind: 'torso', side: 'front' },
    grain: 0, view: opts.view || { x: 0, y: 0 }, sym: opts.sym ?? true, prints: [], strokes: [], overlays: [], hardware: [],
  };
  piece._edgeIds = E.map((e) => e.cid);
  piece._tags = tags;
  return piece;
}
// генератор вернул детали: убрать служебные поля, которые не должны попасть в проект
const tidy = (pieces) => { for (const p of pieces) { delete p._tags; } return pieces; };
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
    ['knee', 'Обхват у колена', 30, 90, 1], ['kneeY', 'Узкое место выше колена на', -8, 14, 0.5], ['hem', 'Обхват низа', 24, 110, 1],
    ['hemBack', 'Низ сзади длиннее (под каблук)', 0, 4, 0.5], ['len', 'Длина от талии', 30, 140, 1], ['elastic', 'Пояс на резинке (0/1)', 0, 1, 1],
    ['artKnee', 'Сгиб у колена (рельеф с посадкой), см', 0, 4, 0.5], ['jeans', 'Джинсы: кокетка, карманы, пояс, гульфик (0/1)', 0, 1, 1],
    ['buttonFly', 'Болт-фронт: пуговицы вместо молнии (0/1)', 0, 1, 1], ['contour', 'Пояс по фигуре — контурный, для низкой посадки (0/1)', 0, 1, 1],
  ],
  skirt: [
    ['ease', 'Свобода по бёдрам', 0, 40, 1], ['len', 'Длина от талии', 25, 130, 1], ['flare', 'Расширение к низу', 0, 60, 1], ['rise', 'Посадка ±', -10, 6, 0.5],
    ['asym', 'Асимметрия низа', -40, 40, 1], ['elastic', 'Пояс на резинке (0/1)', 0, 1, 1],
  ],
  snood: [['w', 'Длина полосы (обхват)', 40, 160, 1], ['h', 'Высота', 15, 80, 1], ['y', 'Положение (от основания шеи)', -10, 15, 0.5]],
};

// значения новых параметров для изделий, созданных до их появления
export const GEN_DEFAULTS = { pants: { kneeY: 0, hemBack: 0, jeans: 0, artKnee: 0, buttonFly: 0, contour: 0 } };

export const GARMENT_PRESETS = [
  { id: 'tee', cat: 'Верх', name: 'Футболка базовая', gen: 'top', layer: 1, mat: 'jer180', p: { ease: 10, len: 70, sleeve: 21, drop: 0, bicep: 6, cuff: 0, cuffEl: 0, neckW: 1, neckF: 8, neckB: 2, armDrop: 1, hemCurve: 0, asym: 0, flare: 1, waist: 0, open: 0, overlap: 0 } },
  { id: 'over', cat: 'Верх', name: 'Футболка оверсайз', gen: 'top', layer: 1, mat: 'jer260', p: { ease: 30, len: 74, sleeve: 27, drop: 8, bicep: 12, cuff: 6, cuffEl: 0, neckW: 1.5, neckF: 8, neckB: 2, armDrop: 6, hemCurve: 0, asym: 0, flare: 0, waist: 0, open: 0, overlap: 0 } },
  { id: 'long', cat: 'Верх', name: 'Лонгслив удлинённый, длинный рукав', gen: 'top', layer: 1, mat: 'vis180', p: { ease: 8, len: 92, sleeve: 76, drop: 0, bicep: 4, cuff: 0, cuffEl: 1, neckW: 2, neckF: 7, neckB: 2, armDrop: 1, hemCurve: 8, asym: 0, flare: 4, waist: 0, open: 0, overlap: 0 } },
  { id: 'tank', cat: 'Верх', name: 'Майка с глубокой проймой', gen: 'top', layer: 1, mat: 'slub160', p: { ease: 8, len: 84, sleeve: 0, drop: -1, bicep: 0, cuff: 0, cuffEl: 0, neckW: 3, neckF: 14, neckB: 4, armDrop: 14, hemCurve: 4, asym: 0, flare: 4, waist: 0, open: 0, overlap: 0 } },
  { id: 'tunic', cat: 'Верх', name: 'Туника с асимметричным низом', gen: 'top', layer: 1, mat: 'gau110', p: { ease: 26, len: 98, sleeve: 30, drop: 7, bicep: 10, cuff: 8, cuffEl: 0, neckW: 2, neckF: 10, neckB: 2.5, armDrop: 5, hemCurve: 4, asym: 26, flare: 10, waist: 0, open: 0, overlap: 0 } },
  { id: 'coat', cat: 'Верх', name: 'Длинный распашной кардиган / пальто', gen: 'top', layer: 2, mat: 'boil450', p: { ease: 28, len: 112, sleeve: 66, drop: 5, bicep: 12, cuff: 8, cuffEl: 0, neckW: 2, neckF: 26, neckB: 2.5, armDrop: 6, hemCurve: 0, asym: 0, flare: 8, waist: 0, open: 1, overlap: 2 } },
  { id: 'trou', cat: 'Брюки', name: 'Брюки прямые', gen: 'pants', layer: 0, mat: 'gab260', p: { ease: 8, rise: 0, drop: 0, knee: 46, kneeY: 0, hem: 42, hemBack: 0, len: 102, elastic: 0, jeans: 0 } },
  { id: 'dropc', cat: 'Брюки', name: 'Брюки с заниженной мотнёй', gen: 'pants', layer: 0, mat: 'jer260', p: { ease: 18, rise: -2, drop: 26, knee: 50, kneeY: 0, hem: 30, hemBack: 0, len: 108, elastic: 1, jeans: 0 } },
  // джинсы: пятикарманка — кокетка, карманы с бочком, пояс с выступом, гульфик на молнии
  { id: 'jeans', cat: 'Джинсы', name: 'Джинсы прямые, 5 карманов', gen: 'pants', layer: 0, mat: 'den12', p: { ease: 6, rise: -1, drop: 0, knee: 44, kneeY: 0, hem: 41, hemBack: 0.5, len: 104, elastic: 0, jeans: 1 } },
  { id: 'bootcut', cat: 'Джинсы', name: 'Джинсы bootcut (слегка расклешённые от колена)', gen: 'pants', layer: 0, mat: 'den11s', p: { ease: 4, rise: -3, drop: 0, knee: 39, kneeY: 2, hem: 48, hemBack: 1.5, len: 108, elastic: 0, jeans: 1, contour: 1 } },
  { id: 'flare', cat: 'Джинсы', name: 'Джинсы клёш (flared)', gen: 'pants', layer: 0, mat: 'den11s', p: { ease: 3, rise: -4, drop: 0, knee: 37, kneeY: 6, hem: 64, hemBack: 2, len: 112, elastic: 0, jeans: 1, contour: 1 } },
  { id: 'skinny', cat: 'Джинсы', name: 'Джинсы узкие (skinny)', gen: 'pants', layer: 0, mat: 'den11s', p: { ease: 2, rise: -3, drop: 0, knee: 34, kneeY: 0, hem: 28, hemBack: 0, len: 106, elastic: 0, jeans: 1, contour: 1 } },
  { id: 'stack', cat: 'Джинсы', name: 'Джинсы stacked — длинные, с набегом у стопы', gen: 'pants', layer: 0, mat: 'den11s', p: { ease: 3, rise: -3, drop: 0, knee: 36, kneeY: 3, hem: 44, hemBack: 1, len: 122, elastic: 0, jeans: 1, contour: 1 } },
  { id: 'wideleg', cat: 'Джинсы', name: 'Джинсы широкие, мотня ниже', gen: 'pants', layer: 0, mat: 'den14', p: { ease: 16, rise: -2, drop: 12, knee: 58, kneeY: 0, hem: 56, hemBack: 1, len: 106, elastic: 0, jeans: 1 } },
  { id: 'skirt', cat: 'Юбки', name: 'Юбка длинная, расклешённая', gen: 'skirt', layer: 0, mat: 'lin185', p: { ease: 6, len: 88, flare: 18, rise: 0, asym: 0, elastic: 0 } },
  { id: 'snood', cat: 'Аксессуары из ткани', name: 'Снуд / хомут', gen: 'snood', layer: 3, mat: 'mohk', p: { w: 92, h: 42, y: 2 } },
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

// ломаная, идущая по высоте: разрезать на уровне y → [до, после] (точка разреза входит в обе части)
function splitAtY(poly, y) {
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1], b = poly[i];
    if ((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue;
    const t = (y - a[1]) / (b[1] - a[1]), P = [lerp(a[0], b[0], t), y];
    const head = poly.slice(0, i), tail = poly.slice(i);
    if (dist(head[head.length - 1], P) < 0.05) head.pop();
    if (dist(tail[0], P) < 0.05) tail.shift();
    return [[...head, P], [P, ...tail]];
  }
  return [poly, [poly[poly.length - 1], poly[poly.length - 1]]];
}
const xAtY = (poly, y) => { const [h] = splitAtY(poly, y); return h[h.length - 1][0]; };
// разрезать ломаную на расстоянии L от начала (для совмещения швов по длине, а не по высоте)
function splitAtLen(poly, L) {
  let acc = 0;
  for (let i = 1; i < poly.length; i++) {
    const d = dist(poly[i - 1], poly[i]);
    if (acc + d >= L && d > 0) {
      const t = (L - acc) / d, P = [lerp(poly[i - 1][0], poly[i][0], t), lerp(poly[i - 1][1], poly[i][1], t)];
      const head = poly.slice(0, i), tail = poly.slice(i);
      if (dist(head[head.length - 1], P) < 0.05) head.pop();
      if (dist(tail[0], P) < 0.05) tail.shift();
      return [[...head, P], [P, ...tail]];
    }
    acc += d;
  }
  return [poly, [poly[poly.length - 1], poly[poly.length - 1]]];
}
const mirrorPts = (pts) => pts.map(([x, y]) => [-x, y]).reverse();

// Сгиб у колена (articulated knee): перед режется над коленом, верх нижней части поднят «горкой» на d.
// Прямая и выпуклая стороны сшиваются с посадкой → у колена появляется объём, брючина сгибается вперёд.
// Спинка делит бок и шаговый шов в тех же местах (по длине), чтобы все швы сходились.
// frontE/backE — стороны с метками: перед [низ, бок 'side', …, шаговый 'in'], спинка — бок с меткой sideTag и шаговый 'in'.
function articulate(frontE, backE, sideTag, yA, d) {
  const n = frontE.length, side = frontE[1], ins = frontE[n - 1];
  const [sLow, sUp] = splitAtY(side.pts, yA), [iUp, iLow] = splitAtY(ins.pts, yA);
  const SA = sLow[sLow.length - 1], IA = iUp[iUp.length - 1];
  const mid = (SA[0] + IA[0]) / 2, w = SA[0] - IA[0];
  const hill = catmull([SA, [mid + w * 0.3, yA + d * 0.7], [mid, yA + d], [mid - w * 0.3, yA + d * 0.7], IA], 6);
  const upper = [{ ...side, pts: sUp, tag: 'sideK' }, ...frontE.slice(2, n - 1), { ...ins, pts: iUp, tag: 'inK' }, { pts: [IA, SA], name: 'колено', sa: 1, tag: 'knee' }];
  const lower = [frontE[0], { ...side, pts: sLow, tag: 'side' }, { pts: hill, name: 'колено', sa: 1, tag: 'knee' }, { ...ins, pts: iLow, tag: 'in' }];
  const back = backE.flatMap((e) => {
    if (e.tag === sideTag) { const [lo, up] = splitAtLen(e.pts, polyLen(sLow)); return [{ ...e, pts: lo }, { ...e, pts: up, tag: sideTag + 'K' }]; }
    if (e.tag === 'in') { const [up, lo] = splitAtLen(e.pts, polyLen(iUp)); return [{ ...e, pts: up, tag: 'inK' }, { ...e, pts: lo }]; }
    return [e];
  });
  return { upper, lower, back };
}
const fmtN = (v) => String(Math.round(v * 10) / 10).replace('.', ',');

export function genPants(M, p) {
  const P = { ...GEN_DEFAULTS.pants, ...p };
  const jeans = !!P.jeans && !P.elastic;
  const bandH = jeans ? 4 : 0;
  const pieces = [], seams = [];
  const drop = clamp(P.drop, 0, Math.max(0, M.y.crotch - M.y.knee - 10 + 25));
  const yW = M.y.waist + P.rise, yH = M.y.hip;
  const yC = Math.max(M.y.ankle + 15, M.y.crotch - 1.5 - drop);
  const cyTop = yC + Math.max(3, (yH - yC) * 0.85);
  const yT = Math.max(yW - bandH, cyTop + 4); // верх брючин; у джинсов выше идёт притачной пояс
  const yK = M.y.knee + P.kneeY;
  const yHem = Math.max(0.8, yW - P.len);
  const Hg = M.hips + P.ease;
  const Fh = Hg / 4 - 1, Bh = Hg / 4 + 1;
  const Fe = Hg / 20 + drop * 0.18, Be = Hg / 10 + drop * 0.28;
  const useKnee = yC > yK + 10 && yHem < yK - 6;
  // обхват тела на высоте верха брючин (низкая посадка — уже не талия, а ближе к бёдрам)
  const girthAt = (y) => (y >= M.y.waist ? M.waist : y <= yH ? M.hips : lerp(M.hips, M.waist, (y - yH) / Math.max(1, M.y.waist - yH)));
  const build = (isBack, adj = { top: 0, crotch: 0 }) => {
    const Hw = isBack ? Bh : Fh, Ex = isBack ? Be : Fe;
    const W1 = Hw + Ex;
    const cf = -W1 / 2 + Ex;
    const side = W1 / 2;
    const kw = (P.knee / 2 + (isBack ? 1 : -1)) / 2, hw = (P.hem / 2 + (isBack ? 1 : -1)) / 2;
    // свобода по линии пояса: брюки ~3,6 см, джинсы ~1,5 см (сидят плотно и не сползают)
    const waistW = P.elastic ? Hw - 0.5 : jeans ? girthAt(yT) / 4 + (isBack ? 0.55 : 0.2) : (girthAt(yT) + 1) / 4 + (isBack ? 0.9 : 0.4);
    const cfW = cf + (isBack ? 2.4 : 0.8);
    const yTc = yT + (isBack ? (jeans ? 2 : 2.5) : 0);
    const sideW = Math.min(side, cfW + waistW);
    // низ: у клёша — перпендикулярно боковым швам (иначе подгибка тянет); сзади длиннее под каблук, спереди короче на подъём стопы
    const flareSlope = useKnee ? Math.max(0, (hw - kw) / Math.max(5, yK - yHem)) : 0;
    const sag = (flareSlope * hw) / 2 + (isBack ? P.hemBack : -0.4 * P.hemBack);
    const hem = [];
    for (let i = 0; i <= 12; i++) { const x = lerp(-hw, hw, i / 12); hem.push([x, yHem - sag * (1 - (x / hw) ** 2)]); }
    const hipY = Math.min(Math.max(yH, yC + 2), yT - 2);
    const yS = yT - adj.top; // спинка: верх бока опущен/поднят так, чтобы боковые швы совпали по длине
    const sideEdge = useKnee
      ? catmull([[hw, yHem], [kw, yK], [side, yC], [side, hipY], [sideW, yS]], 8)
      : catmull([[hw, yHem], [side, yC], [side, hipY], [sideW, yS]], 8);
    const waist = line([sideW, yS], [cfW, yTc], 6);
    const crotch = [[cfW, yTc], ...cubic([cf, cyTop], [cf - (isBack ? 0.4 : 0), yC + (isBack ? 1.2 : 2.4)], [cf - Ex * (isBack ? 0.62 : 0.45), yC - (isBack ? 0.5 : 0) - adj.crotch * 0.5], [-W1 / 2, yC - (isBack ? 1 : 0) - adj.crotch], 14)];
    const crotchPt = crotch[crotch.length - 1];
    const inseam = useKnee ? catmull([crotchPt, [-kw, yK], [-hw, yHem]], 10) : [crotchPt, [-hw, yHem]];
    return { hem, side: sideEdge, waist, crotch, inseam, cfW, yTc, sideW };
  };
  const F = build(false);
  // спинку подгоняем к переду: бок — опусканием верха у бока, шаговый — опусканием шаговой точки (как при проверке лекал)
  let B = build(true);
  for (let it = 0, adj = { top: 0, crotch: 0 }; it < 4; it++) {
    const dS = polyLen(B.side) - polyLen(F.side), dI = polyLen(B.inseam) - polyLen(F.inseam);
    if (Math.abs(dS) < 0.04 && Math.abs(dI) < 0.04) break;
    adj = { top: clamp(adj.top + dS, -3, 3), crotch: clamp(adj.crotch + dI, -3, 3) };
    B = build(true, adj);
  }
  const id = (pc, nm) => pc.corners.find((c) => pc.meta[c.id].name === nm).id;
  const S = (a, b, name, order, extra = {}) => seams.push({ id: uid('s'), a, b, rev: null, name, order, ...extra });

  const kneeOn = (P.artKnee || 0) >= 0.5 && useKnee;
  const yA = yK + 5; // линия сгиба — над коленом
  const leg = (limb, side) => ({ place: { kind: 'leg', limb, side }, sym: false });
  const T = (pc, t) => ({ p: pc.id, e: pc._tags[t] });
  // бок и шаговый шов одной брючины (с учётом сгиба у колена); f — верх переда, low — перед ниже колена или null
  const legSeams = (f, low, b, sideB, s, oSide, oIn, oKnee) => {
    if (low) {
      S(T(f, 'knee'), T(low, 'knee'), `Сгиб у колена: посадить выпуклую сторону (${s})`, oKnee, { ease: true });
      S(T(low, 'side'), T(b, sideB), `Боковой шов ниже колена (${s})`, oSide);
      S(T(f, 'sideK'), T(b, sideB + 'K'), `Боковой шов (${s})`, oSide);
      S(T(low, 'in'), T(b, 'in'), `Шаговый шов ниже колена (${s})`, oIn);
      S(T(f, 'inK'), T(b, 'inK'), `Шаговый шов (${s})`, oIn);
    } else {
      S(T(f, 'side'), T(b, sideB), `Боковой шов (${s})`, oSide);
      S(T(f, 'in'), T(b, 'in'), `Шаговый шов (${s})`, oIn);
    }
  };

  if (!jeans) {
    const edges = (b) => [
      { pts: b.hem, name: 'низ', tag: 'hem' }, { pts: b.side, name: 'бок', tag: 'side' },
      { pts: b.waist, name: 'пояс', gather: P.elastic ? clamp((M.waist + 6) / (2 * Hg / 2 + 2), 0.4, 1) : 1, tag: 'waist' },
      { pts: b.crotch, name: 'средний шов', tag: 'cf' }, { pts: b.inseam, name: 'шаговый шов', tag: 'in' },
    ];
    let fE = edges(F), bE = edges(B), lowE = null;
    if (kneeOn) { const a = articulate(fE, bE, 'side', yA, P.artKnee); fE = a.upper; bE = a.back; lowE = a.lower; }
    const fLp = buildPiece('Передняя половинка (лев.)', fE, leg('L', 'front')), fRp = buildPiece('Передняя половинка (прав.)', mirrorEdges(fE), leg('R', 'front'));
    const bLp = buildPiece('Задняя половинка (лев.)', mirrorEdges(bE), leg('L', 'back')), bRp = buildPiece('Задняя половинка (прав.)', bE, leg('R', 'back'));
    const lL = lowE && buildPiece('Перед ниже колена (лев.)', lowE, leg('L', 'front')), lR = lowE && buildPiece('Перед ниже колена (прав.)', mirrorEdges(lowE), leg('R', 'front'));
    pieces.push(fRp, fLp, ...(lowE ? [lL, lR] : []), bLp, bRp);
    S(T(fLp, 'cf'), T(fRp, 'cf'), 'Средний шов переда', 1);
    S(T(bLp, 'cf'), T(bRp, 'cf'), 'Средний шов спинки', 1);
    legSeams(fLp, lL, bLp, 'side', 'лев.', 2, 3, 0);
    legSeams(fRp, lR, bRp, 'side', 'прав.', 2, 3, 0);
    return { pieces: tidy(pieces), seams };
  }

  // ───── джинсы (пятикарманка). Перед строится в системе левой половинки (бок +x), спинка — правой (бок +x).
  const pw = clamp(Hg * 0.11, 9, 14), pd = clamp(Hg * 0.085, 7, 10); // вход в карман: по поясу и по боку
  const dCB = clamp(Hg * 0.07, 6, 8.5), dS = clamp(Hg * 0.038, 3, 5); // кокетка: глубина по середине и по боку
  const yP = yT - pd, yYS = yT - dS;
  // перед + бочок (подзор): вход в карман — «совок» от бока к поясу
  const [fSide, fSideUp] = splitAtY(F.side, yP);
  const Sp = fSide[fSide.length - 1];
  const xP = Math.max(F.cfW + 7, F.sideW - pw), Wp = [xP, yT];
  const scoop = cubic(Sp, [Sp[0] - (Sp[0] - xP) * 0.62, yP + 0.4], [xP + 0.25, yT - pd * 0.5], Wp, 16);
  const [kSide1, kSide2] = splitAtY(fSideUp, yYS);
  const fWaist = line(Wp, [F.cfW, yT], 6), kWaist = line([F.sideW, yT], Wp, 4);
  const frontE = [
    { pts: F.hem, name: 'низ', sa: 2.5, tag: 'hem' }, { pts: fSide, name: 'бок', tag: 'side' }, { pts: scoop, name: 'вход в карман', sa: 1, tag: 'scoop' },
    { pts: fWaist, name: 'шов пояса', sa: 1, tag: 'waist' }, { pts: F.crotch, name: 'средний шов', tag: 'cf' }, { pts: F.inseam, name: 'шаговый шов', tag: 'in' },
  ];
  // припуск 3 см на стороне входа = подзор, который заходит под перед и закрывает мешковину
  const bochE = [
    { pts: kSide1, name: 'бок', tag: 'side1' }, { pts: kSide2, name: 'бок', tag: 'side2' }, { pts: kWaist, name: 'шов пояса', sa: 1, tag: 'waist' },
    { pts: scoop.slice().reverse(), name: 'подзор', sa: 3, tag: 'scoop' },
  ];
  // спинка + кокетка
  const [bSide1, bRest] = splitAtLen(B.side, polyLen(fSide)); // точки на боку спинки — на тех же расстояниях от низа, что у переда
  const [bSide2, bSideUp] = splitAtLen(bRest, polyLen(kSide1));
  const Y2 = bSide2[bSide2.length - 1];
  const [cbUp, cbLow] = splitAtY(B.crotch, B.yTc - dCB);
  const Y1 = cbUp[cbUp.length - 1];
  const yokeSeam = line(Y2, Y1, 8);
  const backE = [
    { pts: B.hem, name: 'низ', sa: 2.5, tag: 'hem' }, { pts: bSide1, name: 'бок', tag: 'side1' }, { pts: bSide2, name: 'бок', tag: 'side2' },
    { pts: yokeSeam, name: 'кокетка', tag: 'yoke' }, { pts: cbLow, name: 'средний шов', tag: 'cb' }, { pts: B.inseam, name: 'шаговый шов', tag: 'in' },
  ];
  const yokeE = [
    { pts: yokeSeam.slice().reverse(), name: 'кокетка', tag: 'yoke' }, { pts: bSideUp, name: 'бок', tag: 'side' },
    { pts: B.waist, name: 'шов пояса', sa: 1, tag: 'waist' }, { pts: cbUp, name: 'средний шов', tag: 'cb' },
  ];
  let fE = frontE, bE = backE, lowE = null;
  if (kneeOn) { const a = articulate(frontE, backE, 'side1', yA, P.artKnee); fE = a.upper; bE = a.back; lowE = a.lower; }
  const fL = buildPiece('Передняя половинка (лев.)', fE, leg('L', 'front')), fR = buildPiece('Передняя половинка (прав.)', mirrorEdges(fE), leg('R', 'front'));
  const lL = lowE && buildPiece('Перед ниже колена (лев.)', lowE, leg('L', 'front')), lR = lowE && buildPiece('Перед ниже колена (прав.)', mirrorEdges(lowE), leg('R', 'front'));
  const kL = buildPiece('Бочок (лев.)', bochE, leg('L', 'front')), kR = buildPiece('Бочок (прав.)', mirrorEdges(bochE), leg('R', 'front'));
  const bL = buildPiece('Задняя половинка (лев.)', mirrorEdges(bE), leg('L', 'back')), bR = buildPiece('Задняя половинка (прав.)', bE, leg('R', 'back'));
  const yL = buildPiece('Кокетка (лев.)', mirrorEdges(yokeE), leg('L', 'back')), yR = buildPiece('Кокетка (прав.)', yokeE, leg('R', 'back'));
  // пояс: одна полоса от левого края гульфика вокруг до правого. Выступ под пуговицу — припуском на правом конце
  // (выкройка та же, а в 3D кольцо пояса равно линии притачивания); верх — линия сгиба, обтачка = ширина пояса
  const lF = polyLen(fWaist), lK = polyLen(kWaist), lY = polyLen(B.waist), ext = 3.5;
  const xs = [-(lF + lK + lY), -(lK + lY), -lY, 0, lY, lY + lK, lY + lK + lF];
  const y0 = yT;
  const bt = ['f_L', 'k_L', 'y_L', 'y_R', 'k_R', 'f_R'];
  // контурный пояс (низкая посадка): тело под поясом шире, чем над ним → верх короче низа, полоса — дуга кольца.
  // Такой пояс не перегнуть по верху: кроится с отдельной обтачкой, верх — шов.
  const Lb = xs[6] - xs[0], Lt = (Lb * (girthAt(yT + bandH) + 1.5)) / (girthAt(yT) + 1.5);
  const arcR = P.contour && Lb - Lt > 0.5 ? (Lb * bandH) / (Lb - Lt) : 0;
  const bp = (s, h) => (arcR ? [(arcR - h) * Math.sin(s / arcR), y0 + arcR - (arcR - h) * Math.cos(s / arcR)] : [s, y0 + h]);
  const along = (s0, s1, h, n) => Array.from({ length: n + 1 }, (_, i) => bp(lerp(s0, s1, i / n), h));
  const endR = { pts: [bp(xs[6], 0), bp(xs[6], bandH)], name: 'конец пояса, выступ под пуговицу ' + fmtN(ext), sa: ext + 1 };
  const endL = { pts: [bp(xs[0], bandH), bp(xs[0], 0)], name: 'конец пояса', sa: 1 };
  const band = buildPiece('Пояс', [
    ...bt.map((t, i) => ({ pts: along(xs[i], xs[i + 1], 0, Math.max(1, Math.round(xs[i + 1] - xs[i]))), name: 'шов пояса', sa: 1, tag: t })),
    { ...endR, tag: 'endR' },
    arcR ? { pts: along(xs[6], xs[0], bandH, 40), name: 'пояс', sa: 1, tag: 'top' } : { pts: along(xs[6], xs[0], bandH, 40), name: 'пояс', sa: bandH + 1, fold: true, tag: 'top' },
    { ...endL, tag: 'endL' },
  ], { place: arcR ? { kind: 'band', arc: { cx: 0, cy: y0 + arcR, R: arcR, y0, len: Lb } } : { kind: 'band' }, sym: false });
  // внутренние детали: кроятся, но в 3D не драпируются
  const inner = (name, edges, matPreset) => { const pc = buildPiece(name, edges, { place: { kind: 'free' }, sym: false }); pc.inner = true; if (matPreset) pc.matPreset = matPreset; return pc; };
  const bagD = clamp(Hg * 0.25, 22, 30), xi = xP - 2.5, yb = yT - bagD;
  const [, sideBag] = splitAtY(F.side, yP - 4);
  const xo = sideBag[0][0] - 0.6;
  const bagIn = [[xi, yT], [xi + 1, yb + 4], ...cubic([xi + 1, yb + 4], [xi + 1.3, yb], [xo - 3, yb], [xo, yb + 3], 10).slice(1)];
  const bagBackE = [
    { pts: [[F.sideW, yT], [xi, yT]], name: 'шов пояса', sa: 1 }, { pts: bagIn, name: 'край', sa: 1 }, { pts: [[xo, yb + 3], ...sideBag], name: 'бок', sa: 1 },
  ];
  const [, sideBagF] = splitAtY(fSide, yP - 4);
  const bagFrontE = [
    { pts: [Wp, [xi, yT]], name: 'шов пояса', sa: 1 }, { pts: bagIn, name: 'край', sa: 1 }, { pts: [[xo, yb + 3], ...sideBagF], name: 'бок', sa: 1 },
    { pts: scoop, name: 'вход в карман', sa: 1 },
  ];
  const flyLen = clamp(Math.min(Hg * 0.19, yT - yC - 4), 10, 21), yJ = yT - flyLen;
  const [cfUp] = splitAtY(F.crotch, yJ);
  const cb0 = cfUp[cfUp.length - 1];
  const bf = !!P.buttonFly; // болт-фронт: петли на откоске, пуговицы на гульфике
  const flyFacing = inner(bf ? 'Откосок с петлями (к левой половинке)' : 'Откосок (к левой половинке)', [
    { pts: cfUp, name: 'средний шов', sa: 1 },
    { pts: [cb0, ...cubic(cb0, [cb0[0] + 2.5, yJ - 0.3], [cb0[0] + 4.5, yJ + 1], [cb0[0] + 4.5, yJ + 3], 8).slice(1), [F.cfW + 4.5, yT]], name: 'край', raw: true },
    { pts: [[F.cfW + 4.5, yT], [F.cfW, yT]], name: 'шов пояса', sa: 1 },
  ]);
  const fsx = -F.cfW; // гульфик — в системе правой половинки, сложен вдоль: 2 × 4,5 см
  const flyShield = inner(bf ? 'Гульфик под пуговицы (сложить вдоль)' : 'Гульфик (сложить вдоль)', [
    { pts: [[fsx, yJ - 2], [fsx + 9, yJ - 2]], name: 'край', raw: true }, { pts: [[fsx + 9, yJ - 2], [fsx + 9, yT]], name: 'край', raw: true },
    { pts: [[fsx + 9, yT], [fsx, yT]], name: 'шов пояса', sa: 1 }, { pts: [[fsx, yT], [fsx, yJ - 2]], name: 'средний шов', sa: 1 },
  ]);
  const bandFacing = arcR ? inner('Обтачка пояса', [
    { pts: along(xs[0], xs[6], 0, 40), name: 'край', sa: 1 }, { ...endR }, { pts: along(xs[6], xs[0], bandH, 40), name: 'верх пояса', sa: 1, tag: 'top' }, { ...endL },
  ]) : null;
  const nLoops = Hg > 112 ? 7 : 5, loopL = nLoops * 9 + 2;
  const loops = inner(`Шлёвки — полоса, нарезать ${nLoops} × 9 см`, [
    { pts: [[0, 0], [3.6, 0]], name: 'край', raw: true }, { pts: [[3.6, 0], [3.6, loopL]], name: 'край', raw: true },
    { pts: [[3.6, loopL], [0, loopL]], name: 'край', raw: true }, { pts: [[0, loopL], [0, 0]], name: 'край', raw: true },
  ]);
  const bagFL = inner('Мешковина передняя (лев.)', bagFrontE, 'pock'), bagFR = inner('Мешковина передняя (прав.)', mirrorEdges(bagFrontE), 'pock');
  const bagBL = inner('Мешковина задняя (лев.)', bagBackE, 'pock'), bagBR = inner('Мешковина задняя (прав.)', mirrorEdges(bagBackE), 'pock');
  pieces.push(fR, fL, ...(lowE ? [lL, lR] : []), kL, kR, bL, bR, yL, yR, band, ...(bandFacing ? [bandFacing] : []), bagFL, bagFR, bagBL, bagBR, flyFacing, flyShield, loops);

  // накладки (кроятся отдельно, видны в 3D): задние карманы, часовой карман на правом бочке
  const pkW = clamp(Hg * 0.142, 12, 16.5), pkH = pkW * 1.07;
  const pxc = (Y1[0] + Y2[0]) / 2 + 0.6, pyt = lerp(Y2[1], Y1[1], (pxc - Y2[0]) / (Y1[0] - Y2[0])) - 2.2;
  const pocket = [[pxc - pkW / 2, pyt], [pxc - pkW / 2 + 0.5, pyt - pkH + 2.4], [pxc, pyt - pkH], [pxc + pkW / 2 - 0.5, pyt - pkH + 2.4], [pxc + pkW / 2, pyt]];
  bR.overlays.push({ id: uid('o'), name: 'Задний карман', pts: pocket, sa: 1, hem: 3 });
  bL.overlays.push({ id: uid('o'), name: 'Задний карман', pts: mirrorPts(pocket), sa: 1, hem: 3 });
  const cw = clamp(Hg * 0.065, 6, 8), ch = cw * 1.1;
  const cx1 = xAtY(F.side, yT - 2) - 1.0, cx0 = cx1 - cw, cy1 = yT - 1.2, cy0 = cy1 - ch;
  kR.overlays.push({ id: uid('o'), name: 'Часовой карман', pts: mirrorPts([[cx0, cy1], [cx0, cy0], [cx1, cy0], [cx1, cy1]]), sa: 1, hem: 1.5 });
  // фурнитура: заклёпки на углах входа, пуговица на поясе
  const addHw = (pc, x, y, type, size, color) => { if (inside([x, y], pc.pts)) pc.hardware.push({ id: uid('h'), type, x, y, size, color }); };
  for (const [pc, m] of /** @type {[any, number][]} */ ([[fL, 1], [fR, -1]])) { addHw(pc, m * (xP - 0.8), yT - 1.0, 'rivet', 0.9, '#b5835a'); addHw(pc, m * (Sp[0] - 1.1), yP - 0.8, 'rivet', 0.9, '#b5835a'); }
  addHw(kR, -(cx0 + 0.5), cy1 - 0.6, 'rivet', 0.8, '#b5835a'); addHw(kR, -(cx1 - 0.5), cy1 - 0.6, 'rivet', 0.8, '#b5835a');
  const bpos = bp(xs[0] + 1.7, bandH / 2);
  addHw(band, bpos[0], bpos[1], 'button', 1.7, '#8c8a85');
  // J-строчка гульфика на левой половинке (двойная, контрастной нитью)
  for (const off of [3.6, 3.0]) {
    const pts = [];
    for (let y = yT; y > yJ + 2.5; y -= 1) pts.push([xAtY(F.crotch, y) + off, y]);
    const xb = xAtY(F.crotch, yJ);
    pts.push(...cubic([xAtY(F.crotch, yJ + 2.5) + off, yJ + 2.5], [xb + off, yJ - 0.6], [xb + off - 2, yJ - 1.4 - (3.6 - off)], [xb + 0.1, yJ - 1.4 - (3.6 - off)], 8));
    fL.strokes.push({ id: uid('k'), pts, color: '#c48a3c', w: 0.09, alpha: 0.95, mode: 'stitch' });
  }

  for (const [f, low, k, b, y, s] of [[fL, lL, kL, bL, yL, 'лев.'], [fR, lR, kR, bR, yR, 'прав.']]) {
    S(T(y, 'yoke'), T(b, 'yoke'), `Кокетка к задней половинке (${s})`, 10);
    S(T(f, 'scoop'), T(k, 'scoop'), `Вход в карман (${s})`, 12);
    S(T(k, 'side1'), T(b, 'side2'), `Боковой шов у кармана (${s})`, 14);
    S(T(k, 'side2'), T(y, 'side'), `Боковой шов по кокетке (${s})`, 14);
    legSeams(f, low, b, 'side1', s, 14, 15, 8);
  }
  S(T(bL, 'cb'), T(bR, 'cb'), 'Средний шов спинки', 11);
  S(T(yL, 'cb'), T(yR, 'cb'), 'Средний шов кокетки', 11);
  S(T(fL, 'cf'), T(fR, 'cf'), 'Средний шов переда до гульфика', 13);
  const bandTo = { f_L: fL, k_L: kL, y_L: yL, y_R: yR, k_R: kR, f_R: fR };
  for (const t of bt) S(T(band, t), T(bandTo[t], 'waist'), `Пояс: ${bandTo[t].name.replace(' половинка', '')}`, 16);
  if (bandFacing) S(T(band, 'top'), T(bandFacing, 'top'), 'Пояс: верх с обтачкой', 16);
  S(T(band, 'endL'), T(band, 'endR'), 'Застёжка пояса: петля + пуговица (в 3D показана застёгнутой)', 17, { closure: true });

  const nFly = Math.max(3, Math.round(flyLen / 4.5)); // пуговицы болт-фронта, шаг ~4,5 см
  const trims = [bf ? { type: 'button', n: nFly, note: `болт-фронт, ${nFly} шт. ⌀14–17 мм` } : { type: 'zipper', n: 1, note: `молния брючная металлическая ${Math.round(flyLen - 1)} см` }];
  const stepLabels = { 5: 'Подготовка', 8: 'Сгиб у колена', 9: 'Задние карманы', 10: 'Кокетка', 11: 'Средний шов спинки', 12: 'Передние карманы', 13: 'Гульфик и средний шов переда', 14: 'Боковые швы', 15: 'Шаговый шов', 16: 'Пояс и шлёвки', 17: 'Застёжка и отделка' };
  const stepNotes = {
    5: 'Деним постирать до кроя так же, как будет стираться вещь (или впишите усадку ткани — «Образец и замеры»). Игла джинсовая 100–110, отстрочка нитью 40/2, стачивание 100–120. Срезы бочков, откоска, гульфика обметать.',
    9: 'Верх кармана подогнуть 1,5 + 1,5 см и отстрочить; остальные припуски 1 см заутюжить внутрь. Настрочить по меткам двойной строчкой, углы закрепить.',
    10: 'Запошивочный шов или стачать, обметать, заутюжить вверх и отстрочить в две строчки.',
    11: 'Кокетки и задние половинки — одним швом от пояса до шага, запошивочным.',
    12: 'Часовой карман настрочить на правый бочок. Переднюю мешковину стачать с передней половинкой по входу, вывернуть, отстрочить. Бочок настрочить на заднюю мешковину. Мешковины стачать по низу двойным швом. Бочок совместить с передом по меткам, закрепить по поясу и боку.',
    8: 'Нижнюю часть переда притачать к верхней: выпуклую сторону («горку») посадить по прямой, шов заутюжить вверх и отстрочить — колено получит объём.',
    13: bf
      ? `Болт-фронт: на откоске ${nFly} петель по меткам, откосок — к левой половинке; гульфик с пуговицами — к правой. Средний шов переда стачать от шага до низа гульфика, проложить J-строчку.`
      : 'Откосок — к левой половинке, молния — к откоску; гульфик со второй лентой молнии — к правой. Средний шов переда стачать от шага до низа гульфика, проложить J-строчку.',
    14: 'Стачать, обметать вместе, заутюжить к спинке; отстрочить у пояса 5–7 см (или по всей длине).',
    15: 'Запошивочным швом одной строчкой от низа одной брючины до низа другой.',
    16: arcR
      ? 'Контурный пояс: пояс и обтачку стачать по верху, вывернуть, приутюжить. Пояс притачать к брюкам, край обтачки подогнуть и настрочить с лица. Шлёвки: по бокам, у кокеток, на середине спинки.'
      : 'Притачать пояс лицом к изнанке, внутренний край подогнуть на 1 см, перегнуть по линии сгиба, настрочить с лица. Шлёвки: по бокам, у кокеток, на середине спинки.',
    17: 'Петля на левом конце пояса, пуговица — на выступе (правый конец, 3,5 см за линией середины). Заклёпки на углы входа в карманы и часового кармана. Низ подогнуть 1 + 1,5 см.',
  };
  if (!kneeOn) { delete stepLabels[8]; delete stepNotes[8]; }
  return { pieces: tidy(pieces), seams, stepLabels, stepNotes, trims };
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

// накладка как самостоятельная деталь кроя (раскладка, PDF/DXF): короткий многоугольник — стороны по вершинам,
// самая верхняя сторона получает припуск на подгибку o.hem (верх накладного кармана); контур от руки — одна сторона
export function overlayPiece(o, parent) {
  const pts = o.pts.map((q) => [q[0], q[1]]);
  if (area(pts) < 0) pts.reverse();
  const n = pts.length, sa = o.sa ?? 1;
  let edges;
  if (n <= 12) {
    edges = pts.map((a, i) => ({ pts: [a, pts[(i + 1) % n]], name: 'край', sa }));
    if (o.hem) {
      let best = 0;
      edges.forEach((e, i) => { if (e.pts[0][1] + e.pts[1][1] > edges[best].pts[0][1] + edges[best].pts[1][1]) best = i; });
      Object.assign(edges[best], { sa: o.hem, name: 'верх (подгибка)' });
    }
  } else edges = [{ pts: [...pts, pts[0]], name: 'край', sa }];
  const pc = buildPiece(`${o.name || 'Накладка'} (${parent.name})`, edges, { place: { kind: 'free' }, sym: false });
  delete pc._edgeIds; delete pc._tags;
  return Object.assign(pc, { id: o.id, mat: o.mat || parent.mat, grain: parent.grain || 0, base: pc.name, overlayOf: parent.id });
}

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

// допуск сверки длин шва: втачивание рукава и швы с посадкой (сгиб у колена) — до 2,2 см, остальные — 0,35 см
export const seamTol = (s) => (s.ease || (s.name || '').includes('Втачивание') ? 2.2 : 0.35);
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
  const notes = g.stepNotes || {};
  for (const k of Object.keys(notes)) by[k] ||= [];
  const keys = Object.keys(by).map(Number).sort((a, b) => a - b);
  const steps = [];
  const labels = { 0: 'Соединить детали членения (рельефы, вставки)', 1: 'Плечевые / средние швы', 2: 'Боковые швы', 3: 'Втачать рукава / шаговые швы', 4: 'Швы рукавов и боковые швы', 9: 'Пользовательские швы', ...(g.stepLabels || {}) };
  for (const k of keys) steps.push({ title: labels[k] || 'Швы', seams: by[k], note: notes[k] || '' });
  return steps;
}
