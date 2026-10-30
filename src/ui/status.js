// Footer readouts: simulation and fabric use
import { fmt } from '../util.js';
import { $ } from './controls.js';

export function renderStats(app, fps) {
  const s = app.sim;
  $('#stats').innerHTML = `${s.N} точек · ${fmt(fps, 0)} к/с${s.isWorker ? ' · физика ' + fmt(s.stepMs || 0, 0) + ' мс (фон. поток)' : ''} · ${s.settled ? '<span class="pos">ткань стабильна</span>' : s.running ? 'симуляция…' : 'пауза'}`;
  const p = app.selPiece();
  if (p) app._lastPiece = p.id;
}
export function renderWaste(app) {
  const res = app.layout || [];
  if (!res.length) { $('#waste').textContent = ''; return; }
  const used = res.reduce((a, r) => a + r.usedGrams, 0), waste = res.reduce((a, r) => a + r.wasteGrams, 0);
  const util = used / Math.max(1, used + waste);
  const len = res.filter((r) => !r.isHide).reduce((a, r) => a + r.length, 0);
  $('#waste').innerHTML = `ткань ${fmt(len / 100, 2)} м · использование <span class="${util >= 0.85 ? 'pos' : util < 0.72 ? 'neg' : ''}">${fmt(util * 100, 0)}%</span> · в отходы <span class="neg">${fmt(waste, 0)} г</span>`;
}
