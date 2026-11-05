// @ts-check
// Обработка краёв в один клик: обтачка и косая бейка по выбранной стороне детали, подкладка всего изделия.
// Всё это — внутренние детали (piece.inner): кроятся, идут в раскладку, паспорт и себестоимость, в 3D не драпируются.
// Градация: у новых деталей base/baseMirror основной детали — их точки двигаются тем же полем, что и она.
import { buildPiece, edgePts, edgeK, edgeLen, seamOf } from './patterns.js';
import { uid, deep, dist, bbox } from './util.js';

const STEP = {
  18: ['Обтачки и бейки', 'Обтачки: продублировать клеевой прокладкой, сшить между собой по концам, наружный край обметать; притачать к краю изделия, надсечь припуск на закруглениях, отвернуть внутрь, приутюжить с выпуском 1–2 мм, закрепить строчкой или вручную. Бейка: сложить вдвое, заутюжить срезы к середине, вложить край изделия и настрочить по краю, на закруглениях слегка натягивая.'],
  19: ['Подкладка', 'Сшить подкладку так же, как изделие (порядок и швы — как у основных деталей), припуски заутюжить. Вложить в изделие изнанкой к изнанке, притачать по горловине / борту / поясу. По середине спинки — складка 1 см на свободу движения. Низ подкладки — на 2 см выше низа изделия.'],
};
function addStep(g, order) {
  g.extraSteps ||= { labels: {}, notes: {} };
  g.extraSteps.labels[order] = STEP[order][0];
  g.extraSteps.notes[order] = STEP[order][1];
}
const inherit = (c, p) => Object.assign(c, { inner: true, mat: p.mat, grain: p.grain || 0, base: p.base || p.name, ...(p.baseMirror ? { baseMirror: true } : {}) });
// на столе — рядом с основной деталью, не поверх: над ней, если край в верхней половине, иначе под ней
const place = (c, p) => {
  const b = bbox(p.pts), fb = bbox(c.pts), up = (fb.y0 + fb.y1) / 2 > (b.y0 + b.y1) / 2;
  c.view = { x: p.view.x, y: p.view.y + (up ? b.y1 - fb.y0 + 3 : -(fb.y1 - b.y0) - 3) };
};

/** обтачка по стороне: полоса ширины w внутрь детали, сшивается с этой стороной */
export function addFacing(g, p, cid, w = 4) {
  if (seamOf(g, p.id, cid)) return { error: 'Сторона уже сшита — обтачка нужна открытому краю (горловина, пройма, низ, борт)' };
  const k = edgeK(p, cid), e = edgePts(p, k), m = p.meta[cid] || {}, n = e.length;
  if (n < 2) return { error: 'Слишком короткая сторона' };
  // внутренняя нормаль: многоугольник детали обходится против часовой — материал слева от стороны
  const off = e.map((q, i) => {
    const a = e[Math.max(0, i - 1)], b = e[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [q[0] - (dy / l) * w, q[1] + (dx / l) * w];
  });
  const name = m.name || 'край';
  const c = buildPiece(`Обтачка: ${name} (${p.name})`, [
    { pts: e, name: `${name} — к изделию`, sa: m.sa ?? 1, tag: 'edge' },
    { pts: [e[n - 1], off[n - 1]], name: 'конец обтачки', sa: 1 },
    { pts: off.slice().reverse(), name: 'край обтачки', raw: true },
    { pts: [off[0], e[0]], name: 'конец обтачки', sa: 1 },
  ], { place: { kind: 'free' }, sym: false });
  inherit(c, p); place(c, p);
  const e2 = c._tags.edge; delete c._tags; delete c._edgeIds;
  g.pieces.push(c);
  g.seams.push({ id: uid('s'), a: { p: p.id, e: cid }, b: { p: c.id, e: e2 }, rev: false, name: `Обтачка: ${name} (${p.name})`, order: 18 });
  addStep(g, 18);
  return { piece: c };
}

/** косая бейка: полоса 4 × готовой ширины, по косой (45°), на закруглениях на 3 % короче края; край детали — без припуска */
export function addBinding(g, p, cid, fin = 1) {
  if (seamOf(g, p.id, cid)) return { error: 'Сторона уже сшита — бейкой обрабатывают открытый край' };
  const k = edgeK(p, cid), e = edgePts(p, k), m = p.meta[cid] || {}, L = edgeLen(p, k);
  // кривизна: насколько середина стороны отходит от хорды
  const mid = e[Math.floor(e.length / 2)], a = e[0], b = e[e.length - 1], ch = dist(a, b) || 1;
  const sag = Math.abs((b[0] - a[0]) * (a[1] - mid[1]) - (a[0] - mid[0]) * (b[1] - a[1])) / ch;
  const len = L * (sag > 1 ? 0.97 : 1) + 2, w = 4 * fin;
  const name = m.name || 'край';
  const x0 = Math.min(...p.pts.map((q) => q[0])), y0 = Math.min(...p.pts.map((q) => q[1])) - w - 3;
  const c = buildPiece(`Бейка: ${name} (${p.name})`, [
    { pts: [[x0, y0], [x0 + len, y0]], name: `${name} — к изделию`, sa: 0, tag: 'edge' },
    { pts: [[x0 + len, y0], [x0 + len, y0 + w]], name: 'конец бейки', sa: 0 },
    { pts: [[x0 + len, y0 + w], [x0, y0 + w]], name: 'край бейки', sa: 0 },
    { pts: [[x0, y0 + w], [x0, y0]], name: 'конец бейки', sa: 0 },
  ], { place: { kind: 'free' }, sym: false });
  inherit(c, p); c.view = { x: p.view.x, y: p.view.y };
  c.grain = 45; delete c.base; delete c.baseMirror; // полоса не градуируется формой детали: длина — по краю своего размера
  const e2 = c._tags.edge; delete c._tags; delete c._edgeIds;
  g.pieces.push(c);
  g.seams.push({ id: uid('s'), a: { p: p.id, e: cid }, b: { p: c.id, e: e2 }, rev: false, name: `Бейка: ${name} (${p.name})`, order: 18, ease: true });
  Object.assign(m, { sa: 0, bound: fin }); p.meta[cid] = m;
  addStep(g, 18);
  return { piece: c };
}

/** подкладка: копии основных деталей из подкладочной ткани (кроме внутренних, пояса), швы — как у изделия */
export function addLining(g, matId) {
  if (g.pieces.some((p) => p.lining)) return { error: 'Подкладка уже есть' };
  const shell = g.pieces.filter((p) => !p.inner && !p.hidden && p.place?.kind !== 'band');
  if (!shell.length) return { error: 'Нет основных деталей' };
  const pmap = {}, cmap = {}, made = [];
  // на столе — отдельным рядом под изделием, каждая копия под своей деталью
  const low = Math.min(...g.pieces.map((p) => bbox(p.pts).y0 + p.view.y));
  for (const p of shell) {
    const c = deep(p);
    c.id = uid('p'); pmap[p.id] = c.id;
    c.name = 'Подкладка: ' + p.name;
    c.corners = c.corners.map((k) => { const id = uid('c'); cmap[p.id + ':' + k.id] = id; return { i: k.i, id }; });
    const meta = {};
    p.corners.forEach((k) => {
      const mm = { ...(p.meta[k.id] || {}) };
      if (mm.name === 'низ' || mm.name === 'низ рукава') mm.sa = Math.max(0.5, (mm.sa ?? 1) - 2); // низ подкладки на 2 см выше
      delete mm.bound; mm.raw = false;
      meta[cmap[p.id + ':' + k.id]] = mm;
    });
    c.meta = meta;
    Object.assign(c, { inner: true, lining: true, mat: matId, overlays: [], prints: [], strokes: [], hardware: [], place: { kind: 'free' } });
    c.view = { x: p.view.x, y: low - 15 - bbox(p.pts).y1 };
    delete c.srcId;
    made.push(c);
  }
  for (const s of g.seams.slice()) {
    if (!pmap[s.a.p] || !pmap[s.b.p]) continue;
    g.seams.push({ ...s, id: uid('s'), a: { p: pmap[s.a.p], e: cmap[s.a.p + ':' + s.a.e] }, b: { p: pmap[s.b.p], e: cmap[s.b.p + ':' + s.b.e] }, name: 'Подкладка: ' + s.name, order: 19 });
  }
  g.pieces.push(...made);
  addStep(g, 19);
  return { pieces: made };
}

/** убрать подкладку изделия вместе с её швами */
export function removeLining(g) {
  const ids = new Set(g.pieces.filter((p) => p.lining).map((p) => p.id));
  g.pieces = g.pieces.filter((p) => !ids.has(p.id));
  g.seams = g.seams.filter((s) => !ids.has(s.a.p) && !ids.has(s.b.p));
  if (g.extraSteps) { delete g.extraSteps.labels[19]; delete g.extraSteps.notes[19]; }
  return ids.size;
}
