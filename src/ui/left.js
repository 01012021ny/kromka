// Left panel: one renderer per step tab
import { GARMENT_PRESETS, findPiece } from '../patterns.js';
import { PRESETS, CONS, describe, compString, makeMaterial } from '../materials.js';
import { MEAS_LABELS } from '../body.js';
import { ACC_TYPES, makeAcc } from '../accessories.js';
import { esc, fmt } from '../util.js';
import { stockFit } from '../cost.js';
import { $, ctl, bindCtl } from './controls.js';
import { TOOLS, setTool, setMode } from './toolbar.js';

export function renderLeft(app) {
  document.querySelectorAll('#steps button').forEach((b) => b.classList.toggle('on', b.dataset.tab === app.tab));
  const L = $('#left');
  const f = { body: leftBody, garments: leftGarments, materials: leftMaterials, details: leftDetails, acc: leftAcc, layout: leftLayout }[app.tab];
  L.innerHTML = '';
  f(app, L);
}

function leftBody(app, L) {
  const b = app.S.body;
  L.innerHTML = `<div class="sec"><h2>Манекен</h2><p class="note">Пропорции считаются из роста, веса и % жира; любую мерку можно задать вручную — лекала базовых изделий строятся от них.</p>
  <div class="grid2" style="margin-bottom:8px">${[['Подиум, Ж', { sex: 0, height: 178, weight: 55, bf: 19 }], ['Средняя, Ж', { sex: 0, height: 166, weight: 62, bf: 28 }], ['Подиум, М', { sex: 1, height: 186, weight: 70, bf: 11 }], ['Средний, М', { sex: 1, height: 178, weight: 82, bf: 20 }]].map(([n, p], i) => `<button class="sm" data-bp="${i}">${n}</button>`).join('')}</div>
  ${ctl('bSex', 'Пол: женский ↔ мужской', b.sex, 0, 1, 0.05)}${ctl('bH', 'Рост, см', b.height, 140, 205, 1)}${ctl('bW', 'Вес, кг', b.weight, 38, 140, 0.5)}${ctl('bBF', 'Процент жира, %', b.bf, 6, 45, 0.5)}${ctl('bArms', 'Отведение рук, °', b.arms ?? 24, 8, 50, 1)}
  <div class="row"><label>Показать линии мерок</label><button class="sm ${app.body.showMeasures ? 'on' : ''}" id="bMeas">${app.body.showMeasures ? 'вкл' : 'выкл'}</button></div></div>
  <div class="sec"><h3>Мерки <button class="sm ghost" id="bReset">сбросить ручные</button></h3><div id="measRead"></div></div>
  <div class="sec"><h3>Изделия под новую фигуру</h3><p class="note">Изменение манекена сразу меняет посадку в 3D. Чтобы перестроить сами лекала от новых мерок (ручные правки сбросятся):</p><button id="bRefit">Перестроить базовые лекала</button></div>`;
  const PRE = [{ sex: 0, height: 178, weight: 55, bf: 19 }, { sex: 0, height: 166, weight: 62, bf: 28 }, { sex: 1, height: 186, weight: 70, bf: 11 }, { sex: 1, height: 178, weight: 82, bf: 20 }];
  L.querySelectorAll('[data-bp]').forEach((x) => (x.onclick = () => { app.setBody({ ...PRE[+x.dataset.bp], overrides: {} }); renderLeft(app); }));
  let committed = false;
  const live = (key) => (v, fin) => { if (!committed) { app.commit('Манекен'); committed = true; } if (fin) committed = false; app.setBody({ [key]: v }, false); };
  bindCtl('bSex', live('sex'), '', 2); bindCtl('bH', live('height'), '', 0); bindCtl('bW', live('weight')); bindCtl('bBF', live('bf')); bindCtl('bArms', live('arms'), '°', 0);
  $('#bMeas').onclick = () => { app.body.showMeasures = !app.body.showMeasures; app.body.measureGroup.visible = app.body.showMeasures; renderLeft(app); };
  $('#bReset').onclick = () => { app.setBody({ overrides: {} }); renderLeft(app); };
  $('#bRefit').onclick = () => { app.commit('Перестроить лекала'); for (const g of app.S.garments) app.regenerate(g, false); app.toast('Лекала перестроены по новым меркам', 'pos'); };
  renderBodyReadout(app);
}
export function renderBodyReadout(app) {
  const el = $('#measRead'); if (!el) return;
  const m = app.body.m, ov = app.S.body.overrides || {};
  el.innerHTML = `<table class="e">${Object.entries(MEAS_LABELS).map(([k, n]) => `<tr><td>${n}</td><td class="m" style="text-align:right"><input type="number" step="0.5" data-meas="${k}" value="${fmt(m[k])}" style="${ov[k] != null ? 'border-color:var(--ac)' : ''}"> см</td></tr>`).join('')}</table>`;
  el.querySelectorAll('[data-meas]').forEach((inp) => (inp.onchange = () => { const o = { ...(app.S.body.overrides || {}) }; o[inp.dataset.meas] = +inp.value; app.setBody({ overrides: o }); }));
}

function leftGarments(app, L) {
  L.innerHTML = `<div class="sec"><h2>Изделия</h2><p class="note">Базовые конструкции строятся от мерок манекена. Добавьте основу и меняйте её параметрами справа, затем — разрезами, накладками и правкой точек.</p>
  <div class="list">${GARMENT_PRESETS.map((p, i) => `${p.cat && p.cat !== GARMENT_PRESETS[i - 1]?.cat ? `<div class="grp">${p.cat}</div>` : ''}<div class="card" data-add="${p.id}"><div class="sw" style="background:${PRESETS.find((x) => x.id === p.mat)?.color}"></div><div style="flex:1"><div class="t">${p.name}</div><div class="s">${{ top: 'плечевое', pants: 'поясное · брюки', skirt: 'поясное · юбка', snood: 'аксессуар из ткани' }[p.gen]} · слой ${p.layer}</div></div><span class="muted">+</span></div>`).join('')}</div></div>
  <div class="sec"><h3>Слои и детали</h3><div class="tree" id="tree"></div></div>`;
  L.querySelectorAll('[data-add]').forEach((c) => (c.onclick = () => app.addGarment(c.dataset.add)));
  renderTree(app);
}
export function renderTree(app) {
  const el = $('#tree'); if (!el) return;
  const mats = app.matsById();
  const gs = app.S.garments.slice().sort((a, b) => (b.layer || 0) - (a.layer || 0));
  const fold = (app.treeFold ||= new Set());
  el.innerHTML = gs.length ? gs.map((g) => `<div class="g"><div class="gh ${app.sel.g === g.id && !app.sel.p ? 'sel' : ''}" data-g="${g.id}"><button class="eye fold" data-fold="${g.id}" title="${fold.has(g.id) ? 'Показать детали' : 'Свернуть детали'}">${fold.has(g.id) ? '▸' : '▾'}</button><button class="eye" data-vis="${g.id}" title="Показать/скрыть">${g.visible === false ? '○' : '●'}</button><span class="n">${esc(g.name)}</span><button class="eye del" data-del="${g.id}" title="Удалить изделие целиком (вернуть — Ctrl+Z)">✕</button>
      <div class="gc"><span class="chip">слой ${g.layer}</span><button class="eye" data-up="${g.id}" title="Слой выше">▲</button><button class="eye" data-dn="${g.id}" title="Слой ниже">▼</button><span class="muted">${g.pieces.length} дет.</span></div></div>
    ${fold.has(g.id) ? '' : g.pieces.map((p) => `<div class="pc ${app.sel.p === p.id ? 'sel' : ''}" data-p="${p.id}"><button class="eye" data-pv="${p.id}">${p.hidden ? '○' : '●'}</button><span class="sw" style="width:12px;height:12px;background:${mats[p.mat]?.color || '#555'}"></span><span style="flex:1">${esc(p.name)}</span>${p.inner ? '<span class="chip" title="Кроится, но в 3D не показывается: внутри изделия">внутр.</span>' : ''}</div>
      ${(p.overlays || []).map((o) => `<div class="sub ${app.sel.overlay === o.id ? 'sel' : ''}" data-ov="${p.id}:${o.id}">▣ ${esc(o.name)}</div>`).join('')}${(p.prints || []).map((r) => `<div class="sub ${app.sel.print === r.id ? 'sel' : ''}" data-pr="${p.id}:${r.id}">▤ принт</div>`).join('')}`).join('')}</div>`).join('') : '<p class="note">Пока пусто — добавьте основу выше.</p>';
  el.onclick = (e) => {
    const t = e.target;
    const S = app.S;
    if (t.dataset.del) { app.removeGarment(app.garment(t.dataset.del)); return; }
    if (t.dataset.fold) { fold.has(t.dataset.fold) ? fold.delete(t.dataset.fold) : fold.add(t.dataset.fold); renderTree(app); return; }
    if (t.dataset.vis) { const g = app.garment(t.dataset.vis); g.visible = g.visible === false; app.rebuildSim(); app.scheduleLayout(); renderTree(app); app.editor.dirty = true; return; }
    if (t.dataset.pv) { const f = findPiece(S.garments, t.dataset.pv); f.p.hidden = !f.p.hidden; app.rebuildSim(); app.scheduleLayout(); renderTree(app); app.editor.dirty = true; return; }
    if (t.dataset.up || t.dataset.dn) { const g = app.garment(t.dataset.up || t.dataset.dn); app.commit('Порядок слоёв'); g.layer = Math.max(0, (g.layer || 0) + (t.dataset.up ? 1 : -1)); app.rebuildSim(true); renderTree(app); return; }
    const gh = t.closest('[data-g]'); if (gh) { app.select({ g: gh.dataset.g }); return; }
    const pc = t.closest('[data-p]'); if (pc) { app.select({ p: pc.dataset.p }); return; }
    const ov = t.closest('[data-ov]'); if (ov) { const [p, o] = ov.dataset.ov.split(':'); app.select({ p, overlay: o }); return; }
    const pr = t.closest('[data-pr]'); if (pr) { const [p, r] = pr.dataset.pr.split(':'); app.select({ p, print: r }); return; }
  };
}

function leftMaterials(app, L) {
  const S = app.S;
  const groups = {};
  for (const p of PRESETS) (groups[p.group] ||= []).push(p);
  L.innerHTML = `<div class="sec"><h2>Ткани проекта</h2><p class="note">Клик — редактировать состав, плотность и физику справа. Чтобы назначить ткань детали, выберите деталь и смените ткань в инспекторе.</p>
  <div class="list">${S.materials.map((m) => { const d = describe(m); return `<div class="card ${app.sel.mat === m.id ? 'sel' : ''}" data-m="${m.id}"><div class="sw" style="background:${m.color}"></div><div style="flex:1;min-width:0"><div class="t">${esc(m.name)}</div><div class="s">${m.gsm} г/м² · ${esc(compString(m))}</div><div class="s">${d.drape}</div></div></div>`; }).join('')}</div></div>
  <div class="sec"><h3>Библиотека · ${PRESETS.length} основ <input id="libq" placeholder="поиск" style="width:110px;font-size:11px"></h3><div id="lib"></div></div>`;
  const drawLib = (q = '') => {
    const ql = q.toLowerCase();
    $('#lib').innerHTML = Object.entries(groups).map(([gname, list]) => {
      const items = list.filter((p) => !q || (p.name + compString(p) + gname).toLowerCase().includes(ql));
      if (!items.length) return '';
      return `<div class="libgrp">${gname}</div><div class="lib">${items.map((p) => `<div class="card" data-lib="${p.id}" title="${esc(compString(p))} · ${p.gsm} г/м²"><div class="sw" style="background:${p.color};width:16px;height:16px"></div><div style="min-width:0"><div class="t">${esc(p.name)}</div><div class="s">${p.gsm} г/м²</div></div></div>`).join('')}</div>`;
    }).join('');
  };
  drawLib();
  $('#libq').oninput = (e) => drawLib(e.target.value);
  L.querySelectorAll('[data-m]').forEach((c) => (c.onclick = () => { app.select({ mat: c.dataset.m }); renderLeft(app); }));
  $('#lib').onclick = (e) => {
    const c = e.target.closest('[data-lib]'); if (!c) return;
    app.commit('Добавить ткань');
    const m = makeMaterial(c.dataset.lib);
    S.materials.push(m);
    const p = app.selPiece();
    app.select({ mat: m.id });
    renderLeft(app);
    app.toast(p ? 'Ткань добавлена. Назначить её детали можно в инспекторе детали.' : 'Ткань добавлена в проект', 'pos');
  };
}

function leftDetails(app, L) {
  const o = app.toolOpts, S = app.S;
  const matOpts = (sel) => S.materials.map((m) => `<option value="${m.id}" ${sel === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
  L.innerHTML = `<div class="sec"><h2>Детали и слои</h2><p class="note">Инструменты работают на лекалах (справа) и частично прямо на 3D. Всё, что вы добавляете, привязано к детали и движется вместе с ней.</p>
  <div class="grid2">${TOOLS.slice(1).map(([id, ic, n, k]) => `<button class="sm ${app.tool === id ? 'on' : ''}" data-tool="${id}">${ic} ${n} <kbd>${k}</kbd></button>`).join('')}</div></div>
  <div class="sec"><h3>Разрез → отдельная деталь</h3><p class="note">Кривая (C) или от руки (F): линия через деталь от края до края. Обе части становятся самостоятельными деталями, между ними — шов членения с проверкой длин. Назначьте каждой части свою ткань.</p></div>
  <div class="sec"><h3>Накладка (слой поверх)</h3><p class="note">Обведите область (O) — получится накладная деталь: карман, вставка, заплата, аппликация. Она раскладывается на крой отдельно.</p>
  <div class="row"><label>Ткань новых накладок</label><select id="ovMat"><option value="">как у детали</option>${matOpts(o.overlayMat)}</select></div></div>
  <div class="sec"><h3>Кисть</h3>
  <div class="row"><label>Цвет</label><input type="color" id="brC" value="${o.brushColor}"></div><div class="row"><label>Режим</label><div class="pill" id="brM"><button data-m="paint" class="${o.brushMode === 'paint' ? 'on' : ''}">краска</button><button data-m="bleach" class="${o.brushMode === 'bleach' ? 'on' : ''}">вытравка</button></div></div>
  ${ctl('brW', 'Толщина, см', o.brushW, 0.1, 8, 0.1)}${ctl('brA', 'Непрозрачность', o.brushAlpha, 0.05, 1, 0.05)}</div>
  <div class="sec"><h3>Принт</h3><p class="note">PNG с прозрачностью, JPG, SVG. Принт живёт в координатах детали: двигается и тянется вместе с ней.</p>
  <div class="row"><button id="upImg">Загрузить изображение…</button>${app.pendingPrint ? '<span class="chip pos">готов к размещению</span>' : ''}</div>
  ${ctl('prW', 'Ширина при размещении, см', o.printW, 2, 60, 0.5)}</div>
  <div class="sec"><h3>Фурнитура</h3><div class="row"><label>Тип</label><select id="hwT">${[['button', 'Пуговица'], ['snap', 'Кнопка'], ['eyelet', 'Люверс'], ['rivet', 'Заклёпка']].map(([v, n]) => `<option value="${v}" ${o.hwType === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
  ${ctl('hwS', 'Диаметр, см', o.hwSize, 0.6, 4, 0.1)}<div class="row"><label>Цвет</label><input type="color" id="hwC" value="${o.hwColor}"></div></div>
  <div class="sec"><h3>Края и резинки</h3><p class="note">В инспекторе детали у каждой стороны есть: припуск, «сырой край» (без обработки, бахрома) и «резинка» — коэффициент сборки, физика стянет сторону.</p></div>`;
  L.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => { setTool(app, b.dataset.tool); renderLeft(app); }));
  $('#ovMat').onchange = (e) => (o.overlayMat = e.target.value || null);
  $('#brC').oninput = (e) => (o.brushColor = e.target.value);
  $('#brM').onclick = (e) => { const b = e.target.closest('button'); if (b) { o.brushMode = b.dataset.m; renderLeft(app); } };
  bindCtl('brW', (v) => (o.brushW = v)); bindCtl('brA', (v) => (o.brushAlpha = v), '', 2);
  bindCtl('prW', (v) => (o.printW = v));
  $('#upImg').onclick = () => document.getElementById('fileImg').click();
  $('#hwT').onchange = (e) => (o.hwType = e.target.value);
  bindCtl('hwS', (v) => (o.hwSize = v));
  $('#hwC').oninput = (e) => (o.hwColor = e.target.value);
}

function leftAcc(app, L) {
  const S = app.S;
  L.innerHTML = `<div class="sec"><h2>Обувь и аксессуары</h2><p class="note">Параметрические конструкторы: обувь, ремни и стропы (стягивают ткань в физике), цепи, сумки, шапки. Ткань/кожа — из тканей проекта.</p>
  <div class="grid2">${Object.entries(ACC_TYPES).map(([k, t]) => `<button class="sm" data-addacc="${k}">+ ${t.n}</button>`).join('')}</div></div>
  <div class="sec"><h3>В образе</h3><div class="list">${S.accessories.map((a) => `<div class="card ${app.sel.acc === a.id ? 'sel' : ''}" data-acc="${a.id}"><div class="sw" style="background:${app.matsById()[a.mat]?.color || '#222'}"></div><div style="flex:1"><div class="t">${esc(a.name)}</div><div class="s">${ACC_TYPES[a.type].n}</div></div><button class="eye" data-accv="${a.id}">${a.visible === false ? '○' : '●'}</button></div>`).join('') || '<p class="note">Нет аксессуаров</p>'}</div></div>`;
  L.querySelectorAll('[data-addacc]').forEach((b) => (b.onclick = () => {
    app.commit('Аксессуар');
    let m = S.materials.find((x) => CONS[x.cons]?.hide) || S.materials[0];
    if (b.dataset.addacc === 'beanie') m = S.materials.find((x) => CONS[x.cons]?.knit) || m;
    const a = makeAcc(b.dataset.addacc, m.id);
    if (a.type === 'belt') a.p.y = Math.round(app.body.m.y.waist - 3);
    if (a.type === 'shoes' && S.accessories.some((x) => x.type === 'shoes')) { app.toast('Обувь уже есть — отредактируйте её', 'neg'); return; }
    S.accessories.push(a);
    app.rebuildAccessories(); app.select({ acc: a.id }); renderLeft(app); app.autosave();
  }));
  L.querySelectorAll('[data-acc]').forEach((c) => (c.onclick = (e) => {
    if (e.target.dataset.accv) { const a = S.accessories.find((x) => x.id === e.target.dataset.accv); a.visible = a.visible === false; app.rebuildAccessories(); renderLeft(app); return; }
    app.select({ acc: c.dataset.acc }); renderLeft(app);
  }));
}

// вердикт по отрезу: зелёный — хватает (и сколько останется), красный — сколько докупить
export function stockLine(f) {
  if (!f) return '';
  return f.ok
    ? `<p class="note pos">Отреза ${fmt(f.stock, 2)} м хватает: раскладка ${fmt(f.need, 2)} м, останется ${fmt(f.left, 2)} м</p>`
    : `<p class="note neg">Отреза ${fmt(f.stock, 2)} м не хватает: нужно ${fmt(f.need, 2)} м, докупить ${fmt(-f.left, 2)} м — или сузьте/укоротите детали, уменьшите зазор, разрешите поворот 180°</p>`;
}

function leftLayout(app, L) {
  const S = app.S, res = app.layout || [];
  const tot = res.reduce((a, r) => ({ len: a.len + (r.isHide ? 0 : r.length), waste: a.waste + r.wasteGrams, used: a.used + r.usedGrams, cost: a.cost + (r.cost || 0) }), { len: 0, waste: 0, used: 0, cost: 0 });
  const util = tot.used + tot.waste > 0 ? tot.used / (tot.used + tot.waste) : 0;
  L.innerHTML = `<div class="sec"><h2>Раскладка и отходы</h2><p class="note">Пересчитывается при любой правке лекал. Детали ставятся по долевой нити (0°/180°), с припусками и компенсацией усадки.</p>
  <div class="grid2"><div class="stat"><span class="l">использование</span><span class="big ${util >= 0.85 ? 'pos' : util < 0.72 ? 'neg' : ''}">${fmt(util * 100, 0)}%</span></div><div class="stat"><span class="l">в отходы</span><span class="big ${tot.waste > 0 ? 'neg' : 'pos'}">${fmt(tot.waste, 0)} г</span></div>
  <div class="stat"><span class="l">ткани, м</span><span class="big">${fmt(tot.len / 100, 2)}</span></div><div class="stat"><span class="l">стоимость</span><span class="big">${Math.round(tot.cost).toLocaleString('ru')} ₽</span></div></div>
  <div class="row" style="margin-top:10px"><label>Компенсировать усадку</label><button class="sm ${S.settings.shrinkComp ? 'on' : ''}" id="lShr">${S.settings.shrinkComp ? 'да' : 'нет'}</button></div>
  <div class="row"><label>Поворот на 180°</label><button class="sm ${S.settings.rotate ? 'on' : ''}" id="lRot">${S.settings.rotate ? 'можно' : 'нельзя (ворс/рисунок)'}</button></div>
  <div class="row"><label>Зазор между деталями, см</label><input type="number" id="lGap" step="0.1" value="${S.settings.gap}"></div>
  <button id="lShow" style="width:100%;margin-top:6px">Показать раскладку на столе</button></div>
  ${res.map((r) => `<div class="sec"><h3><span><span class="sw" style="display:inline-block;width:10px;height:10px;background:${r.mat.color};vertical-align:middle"></span> ${esc(r.mat.name)}</span><span class="${r.util >= 0.85 ? 'pos' : r.util < 0.72 ? 'neg' : ''}">${fmt(r.util * 100, 0)}%</span></h3>
    <div class="row"><label>Ширина рулона, см</label><input type="number" data-w="${r.mat.id}" value="${r.mat.width}"><button class="sm" data-wopt="${r.mat.id}" title="Перебрать ширины рулона и показать расход">подобрать</button></div><div id="wopt_${r.mat.id}"></div>
    ${r.isHide ? '' : `<div class="row"><label title="Длина куска ткани, который у вас есть. 0 — рулон без ограничения">Мой отрез, м</label><input type="number" step="0.05" min="0" data-stock="${r.mat.id}" value="${r.mat.stock || 0}"></div>${stockLine(stockFit(r))}`}
    <dl class="kv"><dt>${r.isHide ? 'Площадь кожи' : 'Длина отреза'}</dt><dd>${r.isHide ? fmt(r.ft2, 1) + ' фт² → ' + r.hides + ' шк. (~' + r.hideFt2 + ' фт²)' : fmt(r.length / 100, 2) + ' м'}</dd><dt>Деталей</dt><dd>${r.placed.length}${r.placed.some((x) => x.fail) ? ' <span class="neg">· не влезли: ' + r.placed.filter((x) => x.fail).length + '</span>' : ''}</dd><dt>Усадка, компенс.</dt><dd>${r.mat.shrink ? r.mat.shrink[0] + '% / ' + r.mat.shrink[1] + '%' : '—'}</dd><dt>Ткань в изделии</dt><dd>${fmt(r.usedGrams, 0)} г</dd><dt>Отходы</dt><dd class="neg">${fmt(r.wasteGrams, 0)} г</dd></dl>
    ${r.offcuts.slice(0, 4).map((o) => `<div class="offc">остаток <b>${fmt(o.rect.w, 0)}×${fmt(o.rect.h, 0)} см</b> (${fmt(o.area / 100, 1)} дм²) → ${o.ideas.join('; ')}</div>`).join('')}</div>`).join('')}`;
  $('#lShr').onclick = () => { S.settings.shrinkComp = !S.settings.shrinkComp; app.scheduleLayout(); renderLeft(app); };
  $('#lRot').onclick = () => { S.settings.rotate = !S.settings.rotate; app.scheduleLayout(); renderLeft(app); };
  $('#lGap').onchange = (e) => { S.settings.gap = Math.max(0, +e.target.value); app.scheduleLayout(); };
  $('#lShow').onclick = () => setMode(app, 'layout');
  L.querySelectorAll('[data-stock]').forEach((i) => (i.onchange = () => { const m = S.materials.find((x) => x.id === i.dataset.stock); m.stock = Math.max(0, +i.value || 0); app.autosave(); app.scheduleLayout(); }));
  L.querySelectorAll('[data-w]').forEach((i) => (i.onchange = () => { const m = S.materials.find((x) => x.id === i.dataset.w); m.width = Math.max(20, +i.value); app.scheduleLayout(); }));
  L.querySelectorAll('[data-wopt]').forEach((b) => (b.onclick = () => {
    const m = S.materials.find((x) => x.id === b.dataset.wopt);
    const box = document.getElementById('wopt_' + m.id);
    box.innerHTML = '<p class="note">Перебираю ширины…</p>';
    app.widthOptions(m.id, [90, 110, 120, 135, 140, 150, 160, 180]).then((rows) => {
      const best = rows.reduce((a, r) => (!a || r.util > a.util ? r : a), null);
      box.innerHTML = `<table class="e"><tr><th>ширина</th><th>длина</th><th>исп.</th><th>отходы</th><th></th></tr>${rows.map((r) => `<tr${best && best.w === r.w ? ' class="sel"' : ''}><td class="m">${r.w} см</td><td class="m">${fmt(r.length / 100, 2)} м</td><td class="m ${r.util >= 0.85 ? 'pos' : r.util < 0.72 ? 'neg' : ''}">${fmt(r.util * 100, 0)}%</td><td class="m neg">${fmt(r.wasteGrams, 0)} г</td><td><button class="sm ghost" data-setw="${r.w}">выбрать</button></td></tr>`).join('')}</table>`;
      box.querySelectorAll('[data-setw]').forEach((x) => (x.onclick = () => { m.width = +x.dataset.setw; app.scheduleLayout(); }));
    });
  }));
}
