// @ts-check
// Себестоимость изделия: ткань (раскладка только этого изделия), фурнитура (на деталях + из конструкции:
// молния, пуговицы болт-фронта), нитки и минуты пошива по длинам швов. Цены и нормы — ориентиры, их можно менять.
import { nestAll } from './layout.js';
import { seamLengths, edgeLen } from './patterns.js';
import { zipList, zipLabel } from './hardware.js';

/** ориентировочные цены фурнитуры, ₽ за шт. */
export const TRIM_PRICE = { button: 25, snap: 15, eyelet: 6, rivet: 6, zipper: 90 };
export const TRIM_NAME = { button: 'Пуговица', snap: 'Кнопка', eyelet: 'Люверс', rivet: 'Заклёпка', zipper: 'Молния' };
const THREAD_RUB_M = 0.12; // катушка 5000 м ≈ 600 ₽

/**
 * @param {any} g изделие
 * @param {Record<string, any>} mats ткани по id
 * @param {{shrink?:boolean, rotate?:boolean, gap?:number, rate?:number, trimPrice?:Record<string, number>}} [opt]
 */
export function garmentCost(g, mats, opt = {}) {
  const rate = opt.rate ?? 500;
  let lay = [];
  try { lay = nestAll([{ ...g, visible: true }], mats, { shrink: opt.shrink ?? true, rotate: opt.rotate ?? true, gap: opt.gap ?? 0.3 }); } catch (e) { lay = []; }
  const fabric = lay.map((r) => ({ name: r.mat.name, qty: r.isHide ? r.ft2 : r.length / 100, unit: r.isHide ? 'фт²' : 'м', rub: r.cost || 0 }));
  const pieces = g.pieces.filter((p) => !p.hidden);
  // фурнитура
  /** @type {Record<string, number>} */
  const cnt = {};
  /** @type {Record<string, string>} */
  const notes = {};
  for (const p of pieces) for (const h of p.hardware || []) if (!h.zipOf) cnt[h.type] = (cnt[h.type] || 0) + 1; // бегунок — часть молнии
  for (const t of g.trims || []) { cnt[t.type] = (cnt[t.type] || 0) + t.n; if (t.note) notes[t.type] = t.note; }
  const zips = zipList(g);
  if (zips.length) { cnt.zipper = (cnt.zipper || 0) + zips.length; notes.zipper = [notes.zipper, ...zips.map(zipLabel)].filter(Boolean).join('; '); }
  const price = { ...TRIM_PRICE, ...(opt.trimPrice || {}) };
  const trims = Object.entries(cnt).map(([type, n]) => ({ type, name: TRIM_NAME[type] || type, n, note: notes[type] || '', rub: n * (price[type] || 0) }));
  // швы, открытые края, минуты
  let seamCm = 0, nSeams = 0;
  for (const s of g.seams) {
    if (s.closure) continue;
    const sl = seamLengths(g, s);
    if (sl) { seamCm += Math.max(sl.la, sl.lb); nSeams++; }
  }
  const sewn = new Set(g.seams.flatMap((s) => [s.a.p + ':' + s.a.e, s.b.p + ':' + s.b.e]));
  let edgeCm = 0; // подгибка / обметка несшитых краёв
  for (const p of pieces) p.corners.forEach((c, k) => { if (!sewn.has(p.id + ':' + c.id) && !p.meta[c.id]?.raw) edgeCm += edgeLen(p, k); });
  const nOver = pieces.reduce((a, p) => a + (p.overlays || []).filter((o) => !o.hidden).length, 0);
  const nHw = Object.values(cnt).reduce((a, n) => a + n, 0);
  const work = [
    { name: 'Раскрой и разметка', min: (pieces.length + nOver) * 1.2 },
    { name: `Швы: ${nSeams} шт., ${Math.round(seamCm)} см`, min: nSeams * 1.5 + seamCm / 18 },
    { name: `Края: подгибка, обметка ${Math.round(edgeCm)} см`, min: edgeCm / 30 },
    { name: `Накладки: ${nOver} шт.`, min: nOver * 6 },
    { name: `Фурнитура: ${nHw - zips.length} шт.`, min: (nHw - zips.length) * 0.8 },
    { name: `Молнии: ${zips.length} шт.`, min: zips.reduce((a, z) => a + 8 + z.len / 10, 0) },
    { name: 'ВТО и контроль', min: 10 },
  ].filter((w) => w.min > 0);
  const minutes = work.reduce((a, w) => a + w.min, 0);
  const threadM = (seamCm * 7 + edgeCm * 4) / 100; // стачивание + оверлок ≈ 7 длин шва
  const sum = (a) => a.reduce((s, x) => s + x.rub, 0);
  const fabricRub = sum(fabric), trimsRub = sum(trims), threadRub = threadM * THREAD_RUB_M, laborRub = (minutes / 60) * rate;
  return { fabric, trims, work, minutes, threadM, rate, fabricRub, trimsRub, threadRub, laborRub, total: fabricRub + trimsRub + threadRub + laborRub };
}

/** «Хватит ли отреза»: длина раскладки против длины куска ткани (m.stock, м). null — ограничения нет */
export function stockFit(r) {
  const st = +(r?.mat?.stock || 0);
  if (!st || r.isHide) return null;
  const need = r.length / 100;
  return { stock: st, need, left: st - need, ok: need <= st && !r.placed.some((x) => x.fail) };
}
