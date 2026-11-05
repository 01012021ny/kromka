// @ts-check
// Табель мер изделия: замеры по лекалу (в разложенном виде), по 3D на манекене и по сшитому образцу.
// Отсюда же калибровка: систематическое расхождение образца с лекалом → усадка ткани по длине/ширине.
import { edgePts, edgeLen } from './patterns.js';
import { polyLen, bbox } from './util.js';

/** @typedef {{key:string, name:string, val:number, tol:number, axis:'w'|'l'|'', girthY?:number}} SpecRow */

const baseOf = (p) => p.base || p.name.split(' · ')[0];
const outer = (g) => g.pieces.filter((p) => !p.hidden && !p.inner); // внутренние детали (мешковина, откосок) в обмерах не участвуют
const byBase = (g, names) => outer(g).filter((p) => names.includes(baseOf(p)));

// ширина горизонтального сечения многоугольника на высоте y (сумма отрезков внутри)
export function chordWidth(pts, y) {
  const xs = [];
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
  }
  xs.sort((p, q) => p - q);
  let w = 0;
  for (let k = 0; k + 1 < xs.length; k += 2) w += xs[k + 1] - xs[k];
  return w;
}
const widthAt = (pieces, y) => pieces.reduce((s, p) => s + chordWidth(p.pts, y), 0);

// сумма длин сторон с данным именем (после разрезов сторона может быть поделена — суммируем части)
function namedLen(pieces, name, gathered = false) {
  let L = 0;
  for (const p of pieces) for (let k = 0; k < p.corners.length; k++) {
    const m = p.meta[p.corners[k].id];
    if (m?.name === name) L += edgeLen(p, k) * (gathered ? m.gather ?? 1 : 1) - (gathered ? m.lap || 0 : 0);
  }
  return L;
}
function namedEnds(pieces, name) {
  const ys = [];
  for (const p of pieces) for (let k = 0; k < p.corners.length; k++) {
    if (p.meta[p.corners[k].id]?.name !== name) continue;
    const e = edgePts(p, k);
    ys.push(e[0][1], e[e.length - 1][1]);
  }
  return ys;
}
const centreY = (pieces, fn) => { const pts = pieces.flatMap((p) => p.pts.filter((q) => Math.abs(q[0]) < 2.5)); return pts.length ? fn(...pts.map((q) => q[1])) : NaN; };

/**
 * Замеры по лекалу — так, как их снимают с готовой вещи, разложенной на столе.
 * @returns {SpecRow[]}
 */
export function patternSpec(g, M) {
  /** @type {SpecRow[]} */
  const rows = [];
  const add = (key, name, val, tol, axis, girthY) => { if (Number.isFinite(val) && val > 0.5) rows.push({ key, name, val: Math.round(val * 10) / 10, tol, axis, girthY }); };
  if (g.gen === 'top') {
    const backs = byBase(g, ['Спинка']), fronts = byBase(g, ['Перед', 'Полочка левая', 'Полочка правая']);
    const torso = [...backs, ...fronts];
    const sleeves = byBase(g, ['Рукав левый']);
    const ua = Math.max(...namedEnds(backs, 'бок'));
    if (Number.isFinite(ua)) add('chest', 'Ширина по груди (2 см ниже проймы)', widthAt(torso, ua - 2) / 2, 1, 'w', ua - 2);
    add('hem', 'Ширина по низу', namedLen(torso, 'низ') / 2, 1, 'w');
    const hps = Math.max(...backs.flatMap((p) => p.pts.map((q) => q[1])));
    add('length', 'Длина по спинке от основания шеи', hps - centreY(backs, Math.min), 1, 'l');
    add('shoulder', 'Длина плечевого шва', namedLen(backs, 'плечо') / 2, 0.5, 'w');
    const top = backs.flatMap((p) => p.pts.filter((q) => q[1] > hps - 0.6));
    if (top.length) add('neck', 'Ширина горловины (между точками шеи)', Math.max(...top.map((q) => q[0])) - Math.min(...top.map((q) => q[0])), 0.5, 'w');
    if (sleeves.length) {
      const sp = sleeves.flatMap((p) => p.pts);
      const capTop = Math.max(...sp.map((q) => q[1]));
      add('sleeve', 'Длина рукава от вершины оката', capTop - centreY(sleeves, Math.min), 1, 'l');
      const under = Math.max(...namedEnds(sleeves, 'шов рукава'));
      if (Number.isFinite(under)) add('bicep', 'Ширина рукава под проймой', widthAt(sleeves, under - 2.5) / 2, 0.7, 'w');
      add('cuff', 'Ширина низа рукава (в покое)', namedLen(sleeves, 'низ рукава', true) / 2, 0.5, 'w');
    }
    if (M) add('bust3d', 'Полуобхват на уровне груди', widthAt(torso, M.y.bust) / 2, 1, 'w', M.y.bust);
  } else if (g.gen === 'pants') {
    // у джинсов бок и средние швы продолжаются в бочке и кокетке, сверху — притачной пояс
    const fL = byBase(g, ['Передняя половинка (лев.)', 'Перед ниже колена (лев.)', 'Бочок (лев.)']), bL = byBase(g, ['Задняя половинка (лев.)', 'Кокетка (лев.)']);
    const legL = [...fL, ...bL];
    const all = outer(g);
    const band = byBase(g, ['Пояс'])[0];
    const bandH = band ? bbox(band.pts).h : 0;
    add('waist', 'Пояс в расслабленном виде (полуобхват)', namedLen(all, 'пояс', true) / 2, 1, 'w');
    if (M) add('hip', 'Бёдра (полуобхват)', widthAt(all, M.y.hip) / 2, 1, 'w', M.y.hip);
    const crotch = Math.min(...namedEnds(fL, 'шаговый шов').filter((y) => y > (M ? M.y.knee : 40)));
    if (Number.isFinite(crotch)) add('thigh', 'Ширина бедра (2,5 см ниже шага)', widthAt(legL, crotch - 2.5) / 2, 0.7, 'w');
    if (M) add('knee', 'Ширина по колену', widthAt(legL, M.y.knee) / 2, 0.7, 'w');
    add('hem', 'Ширина по низу', namedLen(legL, 'низ') / 2, 0.5, 'w');
    add('inseam', 'Шаговый шов', namedLen(fL, 'шаговый шов'), 1, 'l');
    add('outseam', bandH ? 'Длина по боку с поясом' : 'Боковой шов', namedLen(fL, 'бок') + bandH, 1, 'l');
    add('frise', 'Посадка переда (средний шов' + (bandH ? ' с поясом)' : ')'), namedLen(fL, 'средний шов') + bandH, 0.7, 'l');
    add('brise', 'Посадка спинки (средний шов' + (bandH ? ' с поясом)' : ')'), namedLen(bL, 'средний шов') + bandH, 0.7, 'l');
  } else if (g.gen === 'skirt') {
    const all = outer(g);
    add('waist', 'Пояс в расслабленном виде (полуобхват)', namedLen(all, 'пояс', true) / 2, 1, 'w');
    if (M) add('hip', 'Бёдра (полуобхват)', widthAt(all, M.y.hip) / 2, 1, 'w', M.y.hip);
    add('hem', 'Ширина по низу', namedLen(all, 'низ') / 2, 1.5, 'w');
    const fr = byBase(g, ['Перед юбки']);
    add('length', 'Длина по середине переда', centreY(fr, Math.max) - centreY(fr, Math.min), 1, 'l');
  } else if (g.gen === 'snood') {
    const p = g.pieces[0];
    if (p) { const xs = p.pts.map((q) => q[0]), ys = p.pts.map((q) => q[1]); add('w', 'Длина полосы', Math.max(...xs) - Math.min(...xs), 1, 'l'); add('h', 'Высота', Math.max(...ys) - Math.min(...ys), 1, 'l'); }
  }
  return rows;
}

/**
 * Обхват изделия на манекене по сечению сетки ткани горизонтальной плоскостью (только детали корпуса этого изделия).
 * @param {any} sim @param {any} g @param {number} y
 */
export function drapedGirth(sim, g, y) {
  let L = 0;
  const x = sim.x;
  for (const r of sim.pieces) {
    if (r.garment.id !== g.id || r.piece.place?.kind === 'arm') continue;
    const t = r.mesh.tris, o = r.off;
    for (let k = 0; k < t.length; k += 3) {
      const P = [t[k], t[k + 1], t[k + 2]].map((i) => 3 * (o + i));
      const seg = [];
      for (let e = 0; e < 3; e++) {
        const a = P[e], b = P[(e + 1) % 3];
        const ya = x[a + 1] - y, yb = x[b + 1] - y;
        if ((ya > 0) !== (yb > 0)) { const t2 = ya / (ya - yb); seg.push([x[a] + (x[b] - x[a]) * t2, x[a + 2] + (x[b + 2] - x[a + 2]) * t2]); }
      }
      if (seg.length === 2) L += Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]);
    }
  }
  return L;
}

/** Полный табель: лекало, 3D (для строк-обхватов), образец и расхождения */
export function specTable(g, M, sim, bodyGirth) {
  const rows = patternSpec(g, M);
  const meas = g.sample?.measured || {};
  return rows.map((r) => {
    const out = { ...r, d3: null, ease: null, sample: meas[r.key] ?? null, delta: null, ok: null };
    if (r.girthY != null && sim?.N) {
      const G = drapedGirth(sim, g, r.girthY);
      if (G > 5) { out.d3 = Math.round((G / 2) * 10) / 10; if (bodyGirth) out.ease = Math.round((G - bodyGirth(r.girthY)) * 10) / 10; }
    }
    if (out.sample != null && Number.isFinite(+out.sample)) { out.delta = Math.round((+out.sample - r.val) * 10) / 10; out.ok = Math.abs(out.delta) <= r.tol; }
    return out;
  });
}

/**
 * Систематическая усадка по образцу: среднее относительное расхождение по ширине и по длине (в %, + = вещь села).
 * @returns {{l:number|null, w:number|null, n:number}}
 */
export function sampleShrink(rows) {
  const acc = { l: [], w: [] };
  for (const r of rows) if (r.sample != null && r.axis && r.val > 5) acc[r.axis].push((r.val - +r.sample) / r.val);
  const avg = (a) => (a.length ? Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 1000) / 10 : null);
  return { l: avg(acc.l), w: avg(acc.w), n: acc.l.length + acc.w.length };
}

/** новая усадка ткани = накопленная с учётом найденной по образцу (сложение как множителей) */
export function compoundShrink(oldPct, extraPct) {
  return Math.round((1 - (1 - (oldPct || 0) / 100) * (1 - (extraPct || 0) / 100)) * 1000) / 10;
}
export { polyLen };
