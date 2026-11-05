// Marker view: rolls, placed pieces, offcuts
import { fmt, bbox, centroid } from '../util.js';
import { POS, NEG } from '../editor2d.js';
import { $ } from './controls.js';
import { stockFit } from '../cost.js';

export function drawLayout(app) {
  const wrap = $('#layoutView'), cv = $('#cLay');
  const res = app.layout || [];
  const W = wrap.clientWidth - 24;
  const maxLen = Math.max(100, ...res.map((r) => Math.max(r.length, (stockFit(r)?.stock || 0) * 100)));
  const sc = Math.min(4, (W - 40) / maxLen);
  let H = 20;
  for (const r of res) H += r.W * sc + 70;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = (W + 24) * dpr; cv.height = Math.max(H, wrap.clientHeight) * dpr;
  cv.style.width = W + 24 + 'px'; cv.style.height = Math.max(H, wrap.clientHeight) + 'px';
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#0f0f10'; c.fillRect(0, 0, W + 24, H);
  let y = 24;
  const mono = '10px "JetBrains Mono", monospace';
  if (!res.length) { c.fillStyle = '#8f8a80'; c.font = mono; c.fillText('Нет деталей для раскладки', 20, 40); return; }
  for (const r of res) {
    c.font = '600 12px "Inter Tight", sans-serif'; c.fillStyle = '#e6e1d6';
    c.fillText(`${r.mat.name} · ${r.isHide ? fmt(r.ft2, 1) + ' фт² кожи' : fmt(r.length / 100, 2) + ' м × ' + r.W + ' см'}`, 20, y);
    c.font = mono; c.fillStyle = r.util >= 0.85 ? POS : r.util < 0.72 ? NEG : '#c9c3b6';
    c.fillText(`использование ${fmt(r.util * 100, 0)}% · отходы ${fmt(r.wasteGrams, 0)} г`, 20, y + 15);
    y += 26;
    const ox = 20, oy = y;
    c.save(); c.translate(ox, oy);
    c.fillStyle = '#17171a'; c.fillRect(0, 0, r.length * sc, r.W * sc);
    // offcuts
    c.fillStyle = 'rgba(212,71,59,0.16)';
    for (const o of r.offcuts) if (o.cells) for (const id of o.cells) { const u = id % o.L, v = (id / o.L) | 0; c.fillRect(u * r.cs * sc, v * r.cs * sc, r.cs * sc + 0.5, r.cs * sc + 0.5); }
    c.strokeStyle = 'rgba(212,71,59,0.8)'; c.setLineDash([3, 2]);
    for (const o of r.offcuts.slice(0, 6)) { const q = o.rect; c.strokeRect(q.u * sc, q.v * sc, q.w * sc, q.h * sc); if (q.w * sc > 46 && q.h * sc > 12) { c.fillStyle = 'rgba(240,200,190,0.85)'; c.font = '9px "JetBrains Mono", monospace'; c.fillText(`${fmt(q.w, 0)}×${fmt(q.h, 0)}`, q.u * sc + 3, q.v * sc + 11); c.fillStyle = 'rgba(212,71,59,0.16)'; } }
    c.setLineDash([]);
    for (const pl of r.placed) {
      if (pl.fail) continue;
      c.beginPath(); pl.pts.forEach(([u, v], i) => (i ? c.lineTo(u * sc, v * sc) : c.moveTo(u * sc, v * sc))); c.closePath();
      c.fillStyle = r.mat.color; c.globalAlpha = 0.85; c.fill(); c.globalAlpha = 1;
      c.strokeStyle = '#e6e1d6'; c.lineWidth = 1; c.stroke();
      const ct = centroid(pl.pts), b = bbox(pl.pts);
      if (b.w * sc > 40) { c.font = '9px "JetBrains Mono", monospace'; c.fillStyle = '#f2ede2'; c.textAlign = 'center'; c.fillText(pl.it.name.slice(0, Math.floor(b.w * sc / 6)), ct[0] * sc, ct[1] * sc); c.textAlign = 'left'; }
    }
    // selvedge + ruler
    c.strokeStyle = '#6d6961'; c.strokeRect(0, 0, r.length * sc, r.W * sc);
    // граница отреза: зелёная — раскладка помещается, красная — не хватает
    const sf = stockFit(r);
    if (sf) {
      const X = sf.stock * 100 * sc;
      c.strokeStyle = sf.ok ? POS : NEG; c.lineWidth = 2; c.setLineDash([6, 3]);
      c.beginPath(); c.moveTo(X, -4); c.lineTo(X, r.W * sc + 16); c.stroke(); c.setLineDash([]); c.lineWidth = 1;
      c.fillStyle = sf.ok ? POS : NEG; c.font = '10px "JetBrains Mono", monospace';
      const lbl = `мой отрез ${fmt(sf.stock, 2)} м${sf.ok ? '' : ' — не хватает ' + fmt(-sf.left, 2) + ' м'}`;
      const right = X + 8 + c.measureText(lbl).width > W - 20; // у правого края подпись — слева от линии
      c.textAlign = right ? 'right' : 'left'; c.fillText(lbl, right ? X - 4 : X + 4, r.W * sc + 27); c.textAlign = 'left';
    }
    c.fillStyle = '#6d6961'; c.font = '9px "JetBrains Mono", monospace';
    for (let u = 0; u <= r.length; u += 50) { c.fillRect(u * sc, r.W * sc, 1, 4); c.fillText(u + '', u * sc + 2, r.W * sc + 12); }
    c.restore();
    y += r.W * sc + 40;
  }
}
