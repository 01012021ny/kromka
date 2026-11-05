// File menu: project JSON, tech pack, PNG, production patterns dialog
import { edgePts, seamOf, sewingSteps, cutOutline } from '../patterns.js';
import { FINISHES, compString, makeMaterial } from '../materials.js';
import { MEAS_LABELS, BODY_DEFAULT } from '../body.js';
import { esc, fmt, polyLen, bbox, centroid, deep, area } from '../util.js';
import { SIZES, sizesOf } from '../grading.js';
import { exportSets, pdfVector, dxf, plt, zip, svgNest } from '../export.js';
import { $ } from './controls.js';
import { passportHTML } from './sample.js';

export function doExport(app, kind) {
  const S = app.S;
  $('#menu').style.display = 'none';
  if (kind === 'json') app.save('kromka-proekt.json', JSON.stringify({ app: 'kromka', v: 1, body: S.body, materials: S.materials, garments: S.garments, accessories: S.accessories, images: S.images, settings: S.settings }));
  if (kind === 'open') document.getElementById('fileProj').click();
  if (kind === 'png') { const d = app.view3d.snapshotPNG(); fetch(d).then((r) => r.blob()).then((b) => app.save('kromka-3d.png', b)); }
  if (kind === 'svg') app.save('kromka-lekala.svg', exportSVG(app));
  if (kind === 'prod') openExport(app);
  if (kind === 'passport') {
    const g = app.sel.g ? app.garment(app.sel.g) : S.garments.length === 1 ? S.garments[0] : null;
    if (!g) app.toast('Выберите изделие — паспорт делается для одного изделия', 'neg');
    else app.save(`kromka-pasport-${g.name.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}.html`, passportHTML(app, g));
  }
  if (kind === 'tech') app.save('kromka-tehkarta.html', exportTech(app));
  if (kind === 'new') { app.commit('Новый проект'); app.loadProject({ body: deep(BODY_DEFAULT), materials: [makeMaterial('jer180')], garments: [], accessories: [], images: {} }); }
}
function exportSVG(app) {
  const S = app.S, mats = app.matsById();
  let all = [];
  for (const g of S.garments) if (g.visible !== false) for (const p of g.pieces) if (!p.hidden) all.push({ g, p, co: cutOutline(p) });
  const bb = bbox(all.flatMap(({ p, co }) => co.map(([x, y]) => [x + p.view.x, y + p.view.y])));
  const pad = 5, W = bb.w + pad * 2, H = bb.h + pad * 2;
  const tx = (x, y, p) => `${fmt(x + p.view.x - bb.x0 + pad, 2)},${fmt(bb.y1 - (y + p.view.y) + pad, 2)}`;
  const parts = [];
  for (const { g, p, co } of all) {
    const ct = centroid(p.pts);
    parts.push(`<g id="${p.id}"><title>${esc(g.name)} — ${esc(p.name)}</title>`);
    parts.push(`<polygon points="${co.map(([x, y]) => tx(x, y, p)).join(' ')}" fill="none" stroke="#000" stroke-width="0.08"/>`);
    parts.push(`<polygon points="${p.pts.map(([x, y]) => tx(x, y, p)).join(' ')}" fill="none" stroke="#000" stroke-width="0.05" stroke-dasharray="0.6 0.3"/>`);
    for (const o of p.overlays || []) parts.push(`<polygon points="${o.pts.map(([x, y]) => tx(x, y, p)).join(' ')}" fill="none" stroke="#555" stroke-width="0.05" stroke-dasharray="0.3 0.3"/>`);
    const ga = ((p.grain || 0) * Math.PI) / 180, gl = bbox(p.pts).h * 0.3;
    parts.push(`<line x1="${tx(ct[0] - Math.sin(ga) * gl, ct[1] - Math.cos(ga) * gl, p).split(',')[0]}" y1="${tx(ct[0] - Math.sin(ga) * gl, ct[1] - Math.cos(ga) * gl, p).split(',')[1]}" x2="${tx(ct[0] + Math.sin(ga) * gl, ct[1] + Math.cos(ga) * gl, p).split(',')[0]}" y2="${tx(ct[0] + Math.sin(ga) * gl, ct[1] + Math.cos(ga) * gl, p).split(',')[1]}" stroke="#000" stroke-width="0.06" marker-start="url(#a)" marker-end="url(#a)"/>`);
    for (let k = 0; k < p.corners.length; k++) {
      const c = p.corners[k], sm = seamOf(g, p.id, c.id); if (!sm) continue;
      const e = edgePts(p, k), m = e[Math.floor(e.length / 2)], a = e[Math.max(0, Math.floor(e.length / 2) - 1)], b = e[Math.min(e.length - 1, Math.floor(e.length / 2) + 1)];
      let nx = b[1] - a[1], ny = -(b[0] - a[0]); const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      const sa = p.meta[c.id]?.sa ?? 1;
      const [x1, y1] = tx(m[0], m[1], p).split(','), [x2, y2] = tx(m[0] + nx * (sa + 0.01), m[1] + ny * (sa + 0.01), p).split(',');
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="0.08"/>`);
    }
    const [lx, ly] = tx(ct[0], ct[1], p).split(',');
    parts.push(`<text x="${lx}" y="${ly}" font-size="1.4" text-anchor="middle" font-family="sans-serif">${esc(p.name)}</text>`);
    parts.push(`<text x="${lx}" y="${+ly + 1.8}" font-size="0.9" text-anchor="middle" font-family="monospace">${esc(g.name)} · ${esc(mats[p.mat]?.name || '')} · крой 1 · нить ${p.grain || 0}°</text>`);
    parts.push('</g>');
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(W * 10, 1)}mm" height="${fmt(H * 10, 1)}mm" viewBox="0 0 ${fmt(W, 2)} ${fmt(H, 2)}">
<!-- КРОМКА: масштаб 1:1, единицы viewBox = сантиметры. Сплошная — линия кроя (с припуском), пунктир — линия шва. -->
<defs><marker id="a" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6 z"/></marker></defs>
<rect x="${fmt(pad, 2)}" y="${fmt(H - pad - 1, 2)}" width="10" height="0.15"/><text x="${fmt(pad, 2)}" y="${fmt(H - pad - 1.4, 2)}" font-size="0.9" font-family="monospace">контроль: 10 см</text>
${parts.join('\n')}
</svg>`;
}
function exportTech(app) {
  const S = app.S, m = app.body.m, mats = app.matsById(), res = app.layout || [];
  const rows = (o) => Object.entries(o).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  const svgBlock = exportSVG(app).replace(/^<\?xml[^>]*>/, '').replace(/width="[^"]*mm" height="[^"]*mm"/, 'width="100%"');
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Техкарта — КРОМКА</title><style>body{font:13px/1.45 system-ui,sans-serif;max-width:1000px;margin:30px auto;color:#111;padding:0 20px}h1{letter-spacing:.2em}h2{border-bottom:1px solid #000;padding-bottom:4px;margin-top:28px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left}.neg{color:#b3261e}.pos{color:#2e7d32}.sw{display:inline-block;width:12px;height:12px;border:1px solid #999;vertical-align:middle;margin-right:6px}svg{border:1px solid #ddd;margin-top:10px}</style></head><body>
<h1>КРОМКА · ТЕХКАРТА</h1><p>${new Date().toLocaleDateString('ru')}</p>
<h2>Манекен</h2><table>${rows(Object.fromEntries(Object.entries(MEAS_LABELS).map(([k, n]) => [n, fmt(m[k]) + ' см'])))}<tr><td>Рост</td><td>${m.height} см</td></tr></table>
<h2>Ткани</h2><table><tr><th>Ткань</th><th>Состав</th><th>г/м²</th><th>Ширина</th><th>Обработка</th><th>Усадка Д/Ш</th></tr>${S.materials.map((x) => `<tr><td><span class="sw" style="background:${x.color}"></span>${esc(x.name)}</td><td>${esc(compString(x))}</td><td>${x.gsm}</td><td>${x.width} см</td><td>${FINISHES[x.finish]}</td><td>${x.shrink?.[0] ?? 0}% / ${x.shrink?.[1] ?? 0}%</td></tr>`).join('')}</table>
${S.garments.map((g) => `<h2>${esc(g.name)}</h2><table><tr><th>Деталь</th><th>Ткань</th><th>Нить</th><th>Площадь</th><th>Стороны (длина / припуск)</th></tr>${g.pieces.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(mats[p.mat]?.name || '')}</td><td>${p.grain || 0}°</td><td>${fmt(Math.abs(area(p.pts)) / 100, 1)} дм²</td><td>${p.corners.map((c, k) => `${esc(p.meta[c.id]?.name || '')} ${fmt(polyLen(edgePts(p, k)))}/${p.meta[c.id]?.raw ? 'сырой' : p.meta[c.id]?.sa}`).join('; ')}</td></tr>`).join('')}</table>
<h3>Порядок пошива</h3><ol>${sewingSteps(g).map((s) => `<li><b>${s.title}:</b> ${s.seams.map((x) => esc(x.name)).join(', ')}</li>`).join('')}</ol>`).join('')}
<h2>Аксессуары</h2><p>${S.accessories.map((a) => esc(a.name) + ' (' + Object.entries(a.p).map(([k, v]) => k + ': ' + v).join(', ') + ')').join('<br>') || '—'}</p>
<h2>Раскладка и отходы</h2><table><tr><th>Ткань</th><th>Расход</th><th>Использование</th><th>Отходы</th><th>Стоимость</th></tr>${res.map((r) => `<tr><td>${esc(r.mat.name)}</td><td>${r.isHide ? fmt(r.ft2, 1) + ' фт² (' + r.hides + ' шк.)' : fmt(r.length / 100, 2) + ' м'}</td><td class="${r.util >= 0.85 ? 'pos' : r.util < 0.72 ? 'neg' : ''}">${fmt(r.util * 100, 0)}%</td><td class="neg">${fmt(r.wasteGrams, 0)} г</td><td>${Math.round(r.cost).toLocaleString('ru')} ₽</td></tr>`).join('')}</table>
<h3>Что сделать из остатков</h3><ul>${res.flatMap((r) => r.offcuts.slice(0, 3).map((o) => `<li>${esc(r.mat.name)}: ${fmt(o.rect.w, 0)}×${fmt(o.rect.h, 0)} см → ${o.ideas.join('; ')}</li>`)).join('')}</ul>
<h2>Лекала (масштаб уменьшен; 1:1 — в SVG-экспорте)</h2>${svgBlock}
</body></html>`;
}

function openExport(app) {
  let dlg = document.getElementById('dlg');
  if (!dlg) { dlg = document.createElement('div'); dlg.id = 'dlg'; document.body.appendChild(dlg); }
  const gs = app.S.garments.filter((g) => g.visible !== false);
  const allSizes = SIZES.filter((x) => gs.some((g) => sizesOf(g).includes(x)));
  const bases = new Set(gs.map((g) => g.grading?.base || 'M'));
  dlg.innerHTML = `<div class="box"><h2 style="margin:0 0 4px">Лекала для производства</h2><p class="note">Все форматы — масштаб 1:1, с припусками, нитью, надсечками и подписями деталей.</p>
  <h4>Формат</h4><div class="list">
  <label class="card"><input type="radio" name="fmt" value="pdf" checked><div><div class="t">PDF · листы А4 для домашнего принтера</div><div class="s">вектор: линии точные при любом увеличении; склейка по крестикам, номера листов, линейка 10 см на каждом листе</div></div></label>
  <label class="card"><input type="radio" name="fmt" value="pdfA0"><div><div class="t">PDF · листы А0 для копицентра / плоттера</div><div class="s">крупные листы без склейки — брючина целиком на листе; печатать «по размеру» (100%)</div></div></label>
  <label class="card"><input type="radio" name="fmt" value="dxf"><div><div class="t">ZIP · DXF-AAMA + PLT (HPGL)</div><div class="s">для плоттера, раскройного комплекса и CAD (Gerber, Lectra, Optitex, Valentina); единицы — мм</div></div></label>
  <label class="card"><input type="radio" name="fmt" value="svg"><div><div class="t">SVG · веер размеров</div><div class="s">все размеры наложены друг на друга — проверка градации, печать на плоттере</div></div></label></div>
  <h4>Изделия</h4><div class="row" style="flex-wrap:wrap">${gs.map((g) => `<label style="margin-right:10px"><input type="checkbox" data-xg="${g.id}" checked> ${esc(g.name)}</label>`).join('')}</div>
  <h4>Размеры</h4><div class="row" style="flex-wrap:wrap">${allSizes.map((x) => `<label style="margin-right:8px"><input type="checkbox" data-xs="${x}" ${bases.has(x) ? 'checked' : ''}> ${x}</label>`).join('')}</div>
  <h4>Усадка</h4><label class="row" style="gap:8px"><input type="checkbox" id="xShr"> <span>Увеличить лекала на усадку ткани — для вещей, которые красят или стирают после пошива (garment dye). Сейчас: ${[...new Set(gs.flatMap((g) => g.pieces.map((p) => p.mat)))].map((id) => app.matsById()[id]).filter(Boolean).map((m) => esc(m.name) + ' ' + (m.shrink?.[0] ?? 0) + '/' + (m.shrink?.[1] ?? 0) + '%').join(', ')}</span></label>
  <div class="row" style="margin-top:14px;justify-content:flex-end"><span id="xInfo" class="muted" style="flex:1;font-size:12px"></span><button data-xclose>Отмена</button><button class="on" id="xGo">Сохранить</button></div></div>`;
  dlg.style.display = 'flex';
  dlg.onclick = (e) => { if (e.target === dlg || e.target.closest('[data-xclose]')) dlg.style.display = 'none'; };
  const info = () => {
    const garments = [...dlg.querySelectorAll('[data-xg]:checked')].map((i) => i.dataset.xg), sizes = [...dlg.querySelectorAll('[data-xs]:checked')].map((i) => i.dataset.xs);
    const sets = exportSets(app, { garments, sizes, shrink: dlg.querySelector('#xShr').checked });
    const n = sets.reduce((a, s) => a + s.pieces.length, 0);
    dlg.querySelector('#xInfo').textContent = `${n} деталей · ${sets.length} комплект(ов)`;
    return { sets, sizes, garments };
  };
  dlg.querySelectorAll('input').forEach((i) => (i.onchange = info));
  info();
  dlg.querySelector('#xGo').onclick = async () => {
    const { sets } = info();
    if (!sets.length) { app.toast('Выберите хотя бы одно изделие и размер', 'neg'); return; }
    const fmtSel = dlg.querySelector('input[name=fmt]:checked').value;
    const tag = [...new Set(sets.map((s) => s.size))].join('-') + (sets[0]?.shrink ? '-usadka' : '');
    if (fmtSel === 'pdf' || fmtSel === 'pdfA0') {
      const paper = fmtSel === 'pdfA0' ? 'A0' : 'A4';
      app.toast(`Готовлю листы ${paper === 'A0' ? 'А0' : 'А4'}…`);
      await new Promise((r) => setTimeout(r, 30));
      let r;
      try { r = await pdfVector(app, sets, paper); } catch (e) { console.error(e); app.toast('PDF не собрался: ' + (e?.message || e), 'neg'); return; }
      app.toast(`PDF ${r.paper}: ${r.pages} лист(ов), сетка ${r.rows}×${r.cols}`, 'pos');
      app.save(`kromka-lekala-${paper}-${tag}.pdf`, r.blob);
    } else if (fmtSel === 'dxf') {
      const z = zip([{ name: `kromka-${tag}.dxf`, data: dxf(app, sets) }, { name: `kromka-${tag}.plt`, data: plt(app, sets) }, { name: 'README.txt', data: 'КРОМКА — экспорт лекал\r\nDXF: формат AutoCAD R12, блоки по ASTM D6673 (AAMA): слой 1 — линия кроя, 14 — линия шва, 7 — нить, 4 — надсечки, 8 — накладки, 15 — подписи. Единицы — миллиметры.\r\nPLT: HPGL, 40 ед./мм, перо 1 — крой, перо 2 — шов.\r\n' }]);
      app.save(`kromka-lekala-${tag}.zip`, z);
    } else {
      app.save(`kromka-veer-${tag}.svg`, svgNest(app, sets));
    }
    dlg.style.display = 'none';
  };
}
