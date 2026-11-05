// @ts-check
// Молнии и фурнитура рядами.
//  • Декоративная молния — линия на детали (штрих кисти mode:'zip'): тесьма + зубья в текстуре, бегунок в 3D.
//  • Рабочая молния — в шве (шов становится застёжкой: в 3D застёгнут, в пошиве — вшить молнию)
//    или между двумя открытыми краями (борт ↔ борт): создаётся шов-застёжка.
//  • Ряд люверсов / заклёпок / кнопок вдоль стороны с шагом и отступом от края.
// Бегунок — обычная фурнитура type:'zipper' с полем zipOf (id штриха или 'seam:'+id шва): так он едет за тканью в 3D
// и двигается градацией; в себестоимость идёт не бегунок, а молния целиком (zipList).
import { edgePts, edgeK, seamOf, seamLengths } from './patterns.js';
import { uid, polyLen, pointAt } from './util.js';

/** виды молний: зубья (цвет null — в тон тесьме), ширина цепи и шаг зубьев, см */
export const ZIP_TYPES = {
  metal: { n: 'металлическая', chain: 0.6, pitch: 0.34 },
  coil: { n: 'спиральная', chain: 0.45, pitch: 0.2 },
  hidden: { n: 'потайная', chain: 0, pitch: 0 },
};
export const ZIP_STEP = 7; // шаг пошива «Молнии»
const ZIP_NOTE = 'Молнию примётать по разметке лицом к лицу с краем (зубья — к линии шва), притачать лапкой для молний в 1–2 мм от зубьев; '
  + 'концы тесьмы подвернуть под углом. Разъёмную молнию вшивать до обработки низа, верхние концы — в шов горловины/обтачки. '
  + 'Декоративную — настрочить поверх детали по линии, под ней прорезать ткань (если нужен разрез) и обработать края.';

function addStep(g) {
  g.extraSteps ||= { labels: {}, notes: {} };
  g.extraSteps.labels[ZIP_STEP] = 'Молнии';
  g.extraSteps.notes[ZIP_STEP] = ZIP_NOTE;
}
function dropStepIfUnused(g) {
  if (zipList(g).length || !g.extraSteps) return;
  delete g.extraSteps.labels[ZIP_STEP]; delete g.extraSteps.notes[ZIP_STEP];
}

/** точка в cm от конца линии, который выше (там бегунок, когда молния застёгнута) */
function pullAt(pts, back = 1.2) {
  const top = pts[0][1] >= pts[pts.length - 1][1] ? pts : pts.slice().reverse();
  const L = polyLen(top);
  return pointAt(top, Math.min(0.45, back / Math.max(L, 1e-6))).pt;
}

/**
 * Декоративная молния по линии на детали.
 * @param {any} p деталь @param {number[][]} pts линия в координатах детали
 * @param {{kind?:string, tape?:string, metal?:string, open?:boolean}} [o]
 */
export function addDecorZip(p, pts, o = {}) {
  const kind = ZIP_TYPES[o.kind] ? o.kind : 'metal';
  const s = { id: uid('k'), mode: 'zip', pts, kind, w: 2.6, color: o.tape || '#161617', metal: o.metal || '#9b9b9e', alpha: 1 };
  (p.strokes ||= []).push(s);
  const [x, y] = pullAt(pts);
  (p.hardware ||= []).push({ id: uid('h'), type: 'zipper', x, y, size: 1.7, color: s.metal, zipOf: s.id });
  return s;
}

/** убрать штрих (и бегунок, если это молния) */
export function removeStroke(p, s) {
  p.strokes = (p.strokes || []).filter((x) => x !== s);
  p.hardware = (p.hardware || []).filter((h) => h.zipOf !== s.id);
}

/**
 * Рабочая молния в существующем шве. z = null — убрать.
 * @param {any} g @param {any} s шов @param {{kind?:string, tape?:string, metal?:string, open?:boolean}|null} z
 */
export function setSeamZip(g, s, z) {
  const sides = [s.a, s.b].map((q) => ({ q, p: g.pieces.find((x) => x.id === q.p) })).filter((x) => x.p);
  for (const { p } of sides) p.hardware = (p.hardware || []).filter((h) => h.zipOf !== 'seam:' + s.id);
  if (!z) {
    if (s.zip?.made) g.seams = g.seams.filter((x) => x !== s); // шов создан самой молнией (борт ↔ борт) — убрать целиком
    if (s.zip && !s.zip.wasClosure) delete s.closure;
    delete s.zip;
    for (const { q, p } of sides) if (p.meta[q.e]) delete p.meta[q.e].zip;
    dropStepIfUnused(g);
    return s;
  }
  const kind = ZIP_TYPES[z.kind] ? z.kind : 'metal';
  const wasClosure = s.zip ? s.zip.wasClosure : !!s.closure;
  s.zip = { kind, open: !!z.open, tape: z.tape || '#161617', metal: z.metal || '#9b9b9e', wasClosure, ...(s.zip?.made ? { made: true } : {}) };
  s.closure = true;
  for (const { q, p } of sides) (p.meta[q.e] ||= {}).zip = { kind, tape: s.zip.tape, metal: s.zip.metal };
  if (kind !== 'hidden' && sides[0]) {
    const { q, p } = sides[0], e = edgePts(p, edgeK(p, q.e));
    if (e.length >= 2) {
      const [x, y] = pullAt(e, 1.5), n = inwardAt(e, x, y);
      (p.hardware ||= []).push({ id: uid('h'), type: 'zipper', x: x + n[0] * 0.35, y: y + n[1] * 0.35, size: 1.7, color: s.zip.metal, zipOf: 'seam:' + s.id });
    }
  }
  addStep(g);
  return s;
}

/** внутренняя нормаль многоугольника (CCW: ткань слева от направления обхода) в ближайшей к точке вершине линии */
function inwardAt(e, x, y) {
  let bi = 0, bd = Infinity;
  e.forEach((q, i) => { const d = (q[0] - x) ** 2 + (q[1] - y) ** 2; if (d < bd) { bd = d; bi = i; } });
  const a = e[Math.max(0, bi - 1)], b = e[Math.min(e.length - 1, bi + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
  return [-dy / l, dx / l];
}

/** пара для молнии у открытого края: такая же сторона (по имени) другой детали того же изделия, ещё не сшитая */
export function zipPartner(g, p, cid) {
  const name = p.meta[cid]?.name;
  if (!name || seamOf(g, p.id, cid)) return null;
  for (const o of g.pieces) {
    if (o === p || o.inner) continue;
    for (const c of o.corners) if (o.meta[c.id]?.name === name && !seamOf(g, o.id, c.id)) return { p: o, e: c.id };
  }
  return null;
}

/**
 * Молния между двумя открытыми краями: новый шов-застёжка. rev шва считает вызывающий (seamRev по 3D-расстановке).
 * @returns {any} шов или {error}
 */
export function zipEdges(g, pa, ca, pb, cb, z = {}) {
  if (seamOf(g, pa.id, ca) || seamOf(g, pb.id, cb)) return { error: 'Сторона уже сшита — для молнии в шве выберите сам шов' };
  const name = pa.meta[ca]?.name || 'край';
  const s = { id: uid('s'), a: { p: pa.id, e: ca }, b: { p: pb.id, e: cb }, rev: null, name: `Молния: ${name}`, order: ZIP_STEP };
  g.seams.push(s);
  setSeamZip(g, s, { open: true, ...z });
  s.zip.made = true;
  return s;
}

/**
 * Ряд фурнитуры вдоль стороны: люверсы под шнуровку, заклёпки, кнопки.
 * @param {any} p @param {string} cid
 * @param {{type?:string, step?:number, inset?:number, margin?:number, size?:number, color?:string}} [o]
 * @returns {number} сколько поставлено
 */
export function hardwareAlong(p, cid, o = {}) {
  const k = edgeK(p, cid);
  if (k < 0) return 0;
  const e = edgePts(p, k), L = polyLen(e);
  const step = Math.max(0.8, o.step ?? 3), inset = o.inset ?? 1.2, margin = o.margin ?? Math.max(1.2, step / 2);
  if (L < 2 * margin) return 0;
  const n = Math.max(1, Math.floor((L - 2 * margin) / step + 1e-6) + 1);
  const span = n > 1 ? (L - 2 * margin) : 0, row = uid('r');
  (p.hardware ||= []);
  for (let i = 0; i < n; i++) {
    const t = (margin + (n > 1 ? (span * i) / (n - 1) : (L - 2 * margin) / 2)) / L;
    const { pt } = pointAt(e, t), nn = inwardAt(e, pt[0], pt[1]);
    p.hardware.push({ id: uid('h'), type: o.type || 'eyelet', x: pt[0] + nn[0] * inset, y: pt[1] + nn[1] * inset, size: o.size ?? 1.2, color: o.color || '#8f8f92', row });
  }
  return n;
}

/** все молнии изделия для себестоимости и паспорта */
export function zipList(g) {
  const out = [];
  for (const p of g.pieces) {
    if (p.hidden) continue;
    for (const s of p.strokes || []) if (s.mode === 'zip' && s.pts.length > 1) out.push({ name: `декоративная на «${p.name}»`, len: polyLen(s.pts), kind: s.kind || 'metal', open: false });
  }
  for (const s of g.seams) {
    if (!s.zip) continue;
    const sl = seamLengths(g, s);
    if (sl) out.push({ name: s.name, len: Math.max(sl.la, sl.lb), kind: s.zip.kind, open: s.zip.open });
  }
  return out;
}

/** короткая подпись молнии для паспорта: «разъёмная металлическая 62 см» */
export const zipLabel = (z) => `${z.open ? 'разъёмная ' : ''}${ZIP_TYPES[z.kind]?.n || ''} ${Math.ceil(z.len)} см`.trim();

/** бегунки и зубья, у которых больше нет молнии (шов распороли, штрих удалили) — убрать; → id деталей, где что-то убрано */
export function pruneZipPulls(g) {
  const strokes = new Set(g.pieces.flatMap((p) => (p.strokes || []).map((s) => s.id)));
  const zs = g.seams.filter((s) => s.zip), seams = new Set(zs.map((s) => 'seam:' + s.id));
  const edges = new Set(zs.flatMap((s) => [s.a.p + ':' + s.a.e, s.b.p + ':' + s.b.e]));
  const out = [];
  for (const p of g.pieces) {
    const before = (p.hardware || []).length;
    p.hardware = (p.hardware || []).filter((h) => !h.zipOf || strokes.has(h.zipOf) || seams.has(h.zipOf));
    let ch = before !== p.hardware.length;
    for (const cid in p.meta) if (p.meta[cid]?.zip && !edges.has(p.id + ':' + cid)) { delete p.meta[cid].zip; ch = true; }
    if (ch) out.push(p.id);
  }
  if (out.length) dropStepIfUnused(g);
  return out;
}
