// @ts-check
// Образец и калибровка: табель мер (лекало / 3D / сшитый образец), усадка по образцу → в ткань, паспорт образца
import { specTable, sampleShrink, compoundShrink } from '../spec.js';
import { sewingSteps, seamLengths, edgePts, cutOutline, overlayPiece } from '../patterns.js';
import { compString, FINISHES } from '../materials.js';
import { nestAll } from '../layout.js';
import { exportSets, svgNest } from '../export.js';
import { esc, fmt, polyLen, area } from '../util.js';
import { $ } from './controls.js';

const rowsFor = (app, g) => specTable(g, app.body.m, app.sim, (y) => app.body.girthAt(y));

/** @param {any} app @param {any} g */
export function specHTML(app, g) {
  const rows = rowsFor(app, g);
  if (!rows.length) return '';
  const sm = (g.sample ||= { measured: {}, cutComp: false });
  const sh = sampleShrink(rows);
  const shTxt = (v) => (v == null ? '—' : `<span class="${Math.abs(v) <= 1 ? 'pos' : v > 3 || v < -3 ? 'neg' : ''}">${v > 0 ? 'села ' : v < 0 ? 'растянулась ' : ''}${fmt(Math.abs(v), 1)}%</span>`);
  return `<div class="sec" id="specSec"><h3>Образец и замеры <span class="help-i" title="Сшейте образец по PDF 1:1, постирайте или покрасьте так же, как будет в производстве, разложите на столе и впишите замеры. Красное — вне допуска.">i</span></h3>
  <table class="e"><tr><th>мерка, см</th><th>лекало</th><th title="на манекене: полуобхват ткани; в скобках — свобода к телу по полному обхвату">3D</th><th>образец</th><th>Δ</th></tr>
  ${rows.map((r) => `<tr><td>${esc(r.name)}<br><span class="muted">±${fmt(r.tol, 1)}</span></td><td class="m">${fmt(r.val)}</td>
    <td class="m">${r.d3 == null ? '—' : fmt(r.d3) + (r.ease == null ? '' : `<br><span class="${r.ease < 0 ? 'neg' : 'muted'}">(${r.ease > 0 ? '+' : ''}${fmt(r.ease, 0)})</span>`)}</td>
    <td><input type="number" step="0.1" data-smp="${r.key}" value="${r.sample ?? ''}" style="width:52px"></td>
    <td class="m ${r.ok == null ? '' : r.ok ? 'pos' : 'neg'}">${r.delta == null ? '' : (r.delta > 0 ? '+' : '') + fmt(r.delta)}</td></tr>`).join('')}</table>
  <div class="row"><label style="flex:1">Образец кроился с припуском на усадку</label><input type="checkbox" id="smpComp" ${sm.cutComp ? 'checked' : ''}></div>
  <dl class="kv"><dt>Усадка по длине</dt><dd>${shTxt(sh.l)}</dd><dt>Усадка по ширине</dt><dd>${shTxt(sh.w)}</dd></dl>
  <div class="row" style="flex-wrap:wrap;margin-top:6px"><button class="sm" id="smpApply" ${sh.n < 2 ? 'disabled' : ''} title="Записать найденную усадку в ткани изделия — раскладка и экспорт «с припуском на усадку» станут точнее">Учесть усадку в ткани</button>
  <button class="sm" id="smpPass" title="Документ для пошива и замеров: детали, расход, порядок пошива, табель мер с пустыми графами">Паспорт образца</button>
  <button class="sm ghost" id="smpClr">Очистить замеры</button></div></div>`;
}

/** @param {any} app @param {any} g @param {() => void} rerender */
export function bindSpec(app, g, rerender) {
  if (!document.getElementById('specSec')) return;
  document.querySelectorAll('[data-smp]').forEach((node) => {
    const el = /** @type {HTMLInputElement} */ (node);
    el.onchange = () => {
      const v = el.value === '' ? null : +el.value;
      if (v == null) delete g.sample.measured[el.dataset.smp]; else g.sample.measured[el.dataset.smp] = v;
      app.autosave(); rerender();
    };
  });
  $('#smpComp').onchange = (e) => { g.sample.cutComp = /** @type {HTMLInputElement} */ (e.target).checked; app.autosave(); };
  $('#smpClr').onclick = () => { app.commit('Замеры образца'); g.sample.measured = {}; rerender(); };
  $('#smpPass').onclick = () => app.save(`kromka-pasport-${g.name.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}.html`, passportHTML(app, g));
  $('#smpApply').onclick = () => {
    const sh = sampleShrink(rowsFor(app, g));
    if (sh.n < 2) return;
    app.commit('Усадка по образцу');
    const mats = new Set(g.pieces.map((p) => p.mat));
    const names = [];
    for (const m of app.S.materials) {
      if (!mats.has(m.id)) continue;
      const old = m.shrink || [0, 0];
      // образец без припуска показывает полную усадку; с припуском — только недоучтённую часть
      m.shrink = g.sample.cutComp ? [compoundShrink(old[0], sh.l ?? 0), compoundShrink(old[1], sh.w ?? 0)] : [sh.l ?? old[0], sh.w ?? old[1]];
      names.push(`${m.name}: ${fmt(m.shrink[0], 1)}% / ${fmt(m.shrink[1], 1)}%`);
    }
    app.changed({ layout: true });
    app.toast('Усадка записана в ткани — ' + names.join('; '), 'pos');
    rerender();
  };
}

/** Паспорт образца: всё, что нужно швее и для калибровки, в одном печатном документе */
export function passportHTML(app, g) {
  const mats = app.matsById();
  const rows = rowsFor(app, g);
  const base = g.grading?.base || 'M';
  // детали кроя: основные, внутренние и накладки (карманы кроятся отдельно)
  const cut = g.pieces.filter((p) => !p.hidden).flatMap((p) => [p, ...(p.overlays || []).filter((o) => !o.hidden).map((o) => overlayPiece(o, p))]);
  const used = [...new Set(cut.map((p) => p.mat))].map((id) => mats[id]).filter(Boolean);
  let lay = [];
  try { lay = nestAll([{ ...g, visible: true }], mats, { shrink: app.S.settings.shrinkComp, rotate: app.S.settings.rotate, gap: app.S.settings.gap }); } catch (e) { lay = []; }
  const svg = svgNest(app, exportSets(app, { garments: [g.id], sizes: [base] })).replace(/^<\?xml[^>]*>/, '').replace(/width="[^"]*mm" height="[^"]*mm"/, 'width="100%"');
  const steps = sewingSteps(g);
  const date = new Date().toLocaleDateString('ru');
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Паспорт образца — ${esc(g.name)}</title>
<style>body{font:13px/1.45 system-ui,sans-serif;max-width:980px;margin:28px auto;padding:0 20px;color:#111}h1{letter-spacing:.18em;font-size:20px;margin:0}h2{border-bottom:1.5px solid #000;padding-bottom:3px;margin-top:26px;font-size:15px;text-transform:uppercase;letter-spacing:.06em}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:5px 6px;text-align:left;vertical-align:top}th{background:#f2f2f2;font-weight:600}td.n{font-family:ui-monospace,monospace;text-align:right}td.blank{min-width:70px}
.meta{color:#555}.sw{display:inline-block;width:11px;height:11px;border:1px solid #999;margin-right:6px;vertical-align:middle}ol li{margin:4px 0}svg{border:1px solid #ddd;margin-top:8px}@media print{h2{break-after:avoid}table{break-inside:auto}}</style></head><body>
<h1>КРОМКА · ПАСПОРТ ОБРАЗЦА</h1>
<p class="meta">${esc(g.name)} · размер ${base} (манекен: рост ${fmt(app.body.m.height, 0)}, грудь ${fmt(app.body.m.chest, 0)}, талия ${fmt(app.body.m.waist, 0)}, бёдра ${fmt(app.body.m.hips, 0)} см) · ${date}</p>
<h2>1. Ткани и расход</h2>
<table><tr><th>Ткань</th><th>Состав</th><th>г/м²</th><th>Ширина</th><th>Обработка</th><th>Усадка Д/Ш</th><th>Расход</th></tr>
${used.map((m) => { const r = lay.find((x) => x.mat.id === m.id); return `<tr><td><span class="sw" style="background:${m.color}"></span>${esc(m.name)}</td><td>${esc(compString(m))}</td><td class="n">${m.gsm}</td><td class="n">${m.width} см</td><td>${FINISHES[m.finish] || ''}</td><td class="n">${m.shrink?.[0] ?? 0}% / ${m.shrink?.[1] ?? 0}%</td><td class="n">${r ? (r.isHide ? fmt(r.ft2, 1) + ' фт²' : fmt(r.length / 100, 2) + ' м') : '—'}</td></tr>`; }).join('')}</table>
<h2>2. Детали кроя</h2>
<table><tr><th>Деталь</th><th>Ткань</th><th>Кол-во</th><th>Нить</th><th>Площадь</th><th>Стороны: длина / припуск, см</th></tr>
${cut.map((p) => `<tr><td>${esc(p.name)}${p.inner ? ' <i>— внутренняя</i>' : p.overlayOf ? ' <i>— накладка, место — по меткам</i>' : ''}</td><td>${esc(mats[p.mat]?.name || '')}</td><td class="n">1</td><td class="n">${p.grain || 0}°</td><td class="n">${fmt(Math.abs(area(cutOutline(p))) / 100, 1)} дм²</td><td>${p.corners.map((c, k) => { const m = p.meta[c.id] || {}; return `${esc(m.name || 'сторона')} ${fmt(polyLen(edgePts(p, k)))} / ${m.raw ? 'сырой край' : m.fold ? 'сгиб, обтачка ' + fmt((m.sa ?? 1) - 1, 1) + ' + 1' : fmt(m.sa ?? 1, 1)}${(m.gather ?? 1) < 1 ? ' (резинка ×' + fmt(m.gather, 2) + ')' : ''}${m.lap ? ' (заход ' + fmt(m.lap, 1) + ')' : ''}`; }).join('; ')}</td></tr>`).join('')}</table>
<h2>3. Порядок пошива</h2>
<ol>${steps.map((s) => `<li><b>${esc(s.title)}.</b> ${s.note ? esc(s.note) + (s.seams.length ? '<br>' : '') : ''}${s.seams.map((x) => { const sl = x.closure ? null : seamLengths(g, x); return esc(x.name) + (sl ? ` (${fmt(sl.la)}${Math.abs(sl.diff) >= 0.35 ? ' / ' + fmt(sl.lb) + ' — посадить разницу' : ''} см)` : ''); }).join('; ')}</li>`).join('')}
${g.stepNotes ? '' : '<li><b>Обработка краёв:</b> по припускам из таблицы деталей; «сырой край» не обрабатывать.</li>'}
<li><b>Финиш:</b> стирка / крашение / сушка — так же, как будет в производстве (иначе усадка не проявится).</li></ol>
<h2>4. Табель мер (заполнить по образцу, вещь разложена на столе)</h2>
<table><tr><th>Мерка</th><th>По лекалу</th><th>Допуск ±</th><th>3D на манекене</th><th>Образец до стирки</th><th>Образец после стирки</th><th>Δ</th></tr>
${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="n">${fmt(r.val)}</td><td class="n">${fmt(r.tol, 1)}</td><td class="n">${r.d3 == null ? '—' : fmt(r.d3)}</td><td class="blank"></td><td class="blank">${r.sample ?? ''}</td><td class="n">${r.delta == null ? '' : (r.delta > 0 ? '+' : '') + fmt(r.delta)}</td></tr>`).join('')}</table>
<p class="meta">Все обхваты — полуобхваты (как меряют разложенную вещь). Впишите замеры «после стирки» в КРОМКЕ (Изделие → Образец и замеры) и нажмите «Учесть усадку в ткани»: следующие раскладки и лекала «с припуском на усадку» учтут реальное поведение ткани.</p>
<h2>5. Схема деталей (масштаб уменьшен; для кроя — PDF А4 1:1)</h2>${svg}
</body></html>`;
}
