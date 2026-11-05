// @ts-check
// Web Worker: раскладка и тираж по размерам вне основного потока — интерфейс не замирает на 0,2–2 с после правки
import { nestAll, collectItems, nestMaterial } from './layout.js';
import { expandSizes } from './grading.js';

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'nest') {
      const res = nestAll(m.garments, m.mats, m.opt, (g) => expandSizes(g, m.M));
      postMessage({ type: 'nest', seq: m.seq, res });
    } else if (m.type === 'widths') {
      // подбор ширины рулона: несколько раскладок одной ткани
      const items = collectItems(m.garments, m.mats).find((x) => x.mat.id === m.matId)?.items || [];
      const mat = m.mats[m.matId];
      const rows = [];
      for (const w of m.widths) { const r = nestMaterial(items, { ...mat, width: w }, m.opt); if (!r.placed.some((x) => x.fail)) rows.push({ w, length: r.length, util: r.util, wasteGrams: r.wasteGrams }); }
      postMessage({ type: 'widths', seq: m.seq, matId: m.matId, rows });
    }
  } catch (err) {
    postMessage({ type: 'error', seq: m.seq, message: String(err && /** @type {any} */ (err).message || err) });
  }
};
