// Panels, inspector, toolbar, menus, layout view, exports
import { GARMENT_PRESETS, GEN_PARAMS, edgePts, seamOf, seamLengths, sewingSteps, duplicatePiece, cutOutline, edgeK, findPiece } from './patterns.js';
import { PRESETS, FIBERS, CONS, FINISHES, describe, compString, makeMaterial, defaultShrink, physics } from './materials.js';
import { MEAS_LABELS, measure, BODY_DEFAULT } from './body.js';
import { ACC_TYPES, makeAcc, METALS } from './accessories.js';
import { esc, fmt, polyLen, bbox, centroid, deep, uid, area } from './util.js';
import { POS, NEG } from './editor2d.js';
import { collectItems, nestMaterial } from './layout.js';
import { SIZES, STEP_LABELS, defaultGrading, sizesOf } from './grading.js';
import { exportSets, pdfTiles, dxf, plt, zip, svgNest } from './export.js';

const $ = (s) => document.querySelector(s);
const TABS = [['body', 'Манекен'], ['garments', 'Изделия'], ['materials', 'Ткани'], ['details', 'Детали'], ['acc', 'Обувь и аксессуары'], ['layout', 'Раскладка']];
const TOOLS = [
  ['select', '↖', 'Выбор', 'V', 'Клик — выбрать деталь/сторону. Тяни квадрат — переместить точку, кружок — изогнуть сторону, деталь — подвинуть на столе. Колесо — масштаб, правая кнопка — панорама.'],
  ['point', '+', 'Точка', 'P', 'Клик по стороне — новая угловая точка (шов делится пропорционально). Alt+клик по точке — удалить.'],
  ['cut', '✂', 'Кривая', 'C', 'Кликами ставьте точки плавной кривой через деталь, Enter или двойной клик — разрезать. Получатся 2 детали со швом членения.'],
  ['cutfree', '✎', 'От руки', 'F', 'Проведите линию от края до края детали — деталь разделится по линии, шов добавится сам.'],
  ['overlay', '▣', 'Накладка', 'O', 'Обведите область внутри детали — получится слой поверх (накладка, карман, вставка) со своей тканью и припуском.'],
  ['brush', '●', 'Кисть', 'B', 'Рисуйте по лекалу или прямо по 3D-модели. Цвет, толщина и режим — в панели «Детали».'],
  ['print', '▤', 'Принт', 'I', 'Клик по детали — разместить изображение (PNG с прозрачностью). Перетаскивание двигает, колесо — масштаб.'],
  ['hw', '◎', 'Фурнит.', 'H', 'Клик по детали — поставить пуговицу, кнопку, люверс или заклёпку.'],
  ['seam', '⇄', 'Шов', 'S', 'Клик по одной стороне, затем по другой — сшить. Alt+клик — распороть шов.'],
];

export function init(app) {
  // steps
  const nav = $('#steps');
  nav.innerHTML = TABS.map(([id, n], i) => `<button data-tab="${id}"><i>0${i + 1}</i>${n}</button>`).join('');
  nav.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; app.tab = b.dataset.tab; if (app.tab === 'layout') setMode(app, 'layout'); else if (app.mode2d === 'layout') setMode(app, 'pattern'); renderLeft(app); });
  // tools
  renderTools(app);
  // 3D bar
  $('#bPlay').onclick = () => { app.sim.running = !app.sim.running; if (app.sim.running) app.sim.wake(); app.updatePlay(); };
  $('#bResew').onclick = () => { app.rebuildSim(true); app.toast('Изделия заново сшиты из лекал'); };
  $('#bStrain').onclick = (e) => { const on = !app.view3d.showStrain; app.view3d.setStrain(on); e.target.classList.toggle('on', on); $('#legend').style.display = on ? 'block' : 'none'; };
  $('#quality').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; app.S.settings.quality = +b.dataset.q; [...$('#quality').children].forEach((x) => x.classList.toggle('on', x === b)); app.rebuildSim(); });
  document.querySelectorAll('[data-cam]').forEach((b) => (b.onclick = () => {
    const H = app.body.m.height, c = app.view3d.camera, t = app.view3d.controls.target;
    t.set(0, H * 0.55, 0);
    const d = H * 2.05;
    if (b.dataset.cam === 'front') c.position.set(0, H * 0.62, d);
    if (b.dataset.cam === 'back') c.position.set(0, H * 0.62, -d);
    if (b.dataset.cam === 'side') c.position.set(d, H * 0.62, 0);
  }));
  // header
  $('#bUndo').onclick = () => app.undo();
  $('#bRedo').onclick = () => app.redo();
  $('#bHelp').onclick = () => showHelp(true);
  $('#help').onclick = (e) => { if (e.target.id === 'help' || e.target.closest('[data-close]')) showHelp(false); };
  $('#bExport').onclick = (e) => { e.stopPropagation(); const m = $('#menu'); m.style.display = m.style.display === 'block' ? 'none' : 'block'; };
  document.addEventListener('click', () => ($('#menu').style.display = 'none'));
  $('#menu').innerHTML = [
    ['prod', 'Лекала для производства…', 'PDF А4 1:1 для печати · DXF-AAMA и PLT для плоттера · SVG веер размеров'],
    ['tech', 'Техкарта — HTML', 'мерки, ткани, детали, порядок пошива, расход и отходы'],
    ['png', 'Снимок 3D — PNG', 'текущий вид'],
    ['json', 'Сохранить проект — JSON', 'всё: манекен, ткани, лекала, принты'],
    ['open', 'Открыть проект…', 'из файла JSON'],
    ['new', 'Новый проект', 'начать с пустого манекена'],
  ].map(([id, t, s]) => `<button data-x="${id}">${t}<span class="s">${s}</span></button>`).join('');
  $('#menu').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) doExport(app, b.dataset.x); });
  // split
  const split = $('#split');
  split.addEventListener('pointerdown', (e) => {
    split.setPointerCapture(e.pointerId);
    const main = document.querySelector('main'), r = main.getBoundingClientRect();
    const mv = (ev) => { const f = Math.max(0.2, Math.min(0.8, (ev.clientX - r.left) / r.width)); main.style.gridTemplateColumns = `${f}fr 6px ${1 - f}fr`; };
    const up = () => { split.removeEventListener('pointermove', mv); split.removeEventListener('pointerup', up); };
    split.addEventListener('pointermove', mv); split.addEventListener('pointerup', up);
  });
  // keys
  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input,textarea,select')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? app.redo() : app.undo(); return; }
    if (e.key === ' ') { app.spaceDown = true; return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(app); return; }
    const t = TOOLS.find((x) => x[3].toLowerCase() === e.key.toLowerCase());
    if (t && !e.ctrlKey && !e.metaKey) setTool(app, t[0]);
    if (e.key === '?') showHelp(true);
  });
  window.addEventListener('keyup', (e) => { if (e.key === ' ') app.spaceDown = false; });
  $('#helpBox').innerHTML = HELP;
}

function renderTools(app) {
  const bar = $('#tools2d');
  bar.innerHTML = `<div class="pill"><button data-mode="pattern" class="${app.mode2d === 'pattern' ? 'on' : ''}">Лекала</button><button data-mode="layout" class="${app.mode2d === 'layout' ? 'on' : ''}">Раскладка</button></div><div class="sep"></div>` + TOOLS.map(([id, ic, n, k]) => `<button class="tool sm ${app.tool === id ? 'on' : ''}" data-tool="${id}" title="${n} — клавиша ${k}">${ic}</button>`).join('') +
    `<span class="ttl" style="margin-left:6px">${(TOOLS.find((t) => t[0] === app.tool) || [])[2] || ''}</span><div class="sep"></div><button class="sm ${app.S.settings.showSA ? 'on' : ''}" data-tg="showSA" title="Показывать линию кроя с припусками">Припуски</button><button class="sm ${app.S.settings.showLen ? 'on' : ''}" data-tg="showLen" title="Длины сторон и сверка швов">Длины</button><button class="sm ghost" data-fit title="Вписать все лекала">⤢</button>`;
  bar.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tool) setTool(app, b.dataset.tool);
    if (b.dataset.tg) { app.S.settings[b.dataset.tg] = !app.S.settings[b.dataset.tg]; app.editor.dirty = true; renderTools(app); }
    if (b.dataset.fit !== undefined) app.editor.fit();
    if (b.dataset.mode) setMode(app, b.dataset.mode);
  };
  const t = TOOLS.find((x) => x[0] === app.tool);
  $('#hint').textContent = t ? `${t[2]}: ${t[4]}` : '';
}
export function setTool(app, id) {
  app.tool = id; app.editor.tmp = null; app.editor.dirty = true;
  if (app.mode2d === 'layout') setMode(app, 'pattern');
  renderTools(app);
  if (['overlay', 'brush', 'print', 'hw', 'cut', 'cutfree'].includes(id) && app.tab !== 'details') { app.tab = 'details'; renderLeft(app); }
}
function setMode(app, m) {
  app.mode2d = m;
  $('#layoutView').style.display = m === 'layout' ? 'block' : 'none';
  $('#v2d').style.display = m === 'layout' ? 'none' : 'block';
  renderTools(app);
  if (m === 'layout') drawLayout(app); else { app.editor.resize(); app.editor.dirty = true; }
}
function showHelp(on) { $('#help').style.display = on ? 'flex' : 'none'; }

// ───────── generic controls ─────────
function ctl(id, label, v, min, max, step, unit = '') {
  if (min === 0 && max === 1 && step === 1) return `<div class="row"><label style="flex:1">${label.replace(/\s*\(0\/1\)/, '')}</label><input type="checkbox" id="${id}" ${+v ? 'checked' : ''}></div>`;
  return `<div class="ctl"><label>${label}<b id="${id}_v">${fmt(v, step < 1 ? 1 : 0)}${unit}</b></label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}"><input type="number" id="${id}_n" min="${min}" max="${max}" step="${step}" value="${+(+v).toFixed(2)}"></div>`;
}
function bindCtl(id, fn, unit = '', dec = 1) {
  const r = document.getElementById(id), n = document.getElementById(id + '_n'), v = document.getElementById(id + '_v');
  if (!r) return;
  if (r.type === 'checkbox') { r.onchange = () => fn(r.checked ? 1 : 0, true); return; }
  const upd = (val, fin) => { r.value = val; n.value = val; v.textContent = fmt(+val, dec) + unit; fn(+val, fin); };
  r.oninput = () => upd(r.value, false); r.onchange = () => upd(r.value, true);
  n.onchange = () => upd(n.value, true);
}

// ───────── left panel ─────────
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
  <div class="list">${GARMENT_PRESETS.map((p) => `<div class="card" data-add="${p.id}"><div class="sw" style="background:${PRESETS.find((x) => x.id === p.mat)?.color}"></div><div style="flex:1"><div class="t">${p.name}</div><div class="s">${{ top: 'плечевое', pants: 'поясное · брюки', skirt: 'поясное · юбка', snood: 'аксессуар из ткани' }[p.gen]} · слой ${p.layer}</div></div><span class="muted">+</span></div>`).join('')}</div></div>
  <div class="sec"><h3>Слои и детали</h3><div class="tree" id="tree"></div></div>`;
  L.querySelectorAll('[data-add]').forEach((c) => (c.onclick = () => app.addGarment(c.dataset.add)));
  renderTree(app);
}
export function renderTree(app) {
  const el = $('#tree'); if (!el) return;
  const mats = app.matsById();
  const gs = app.S.garments.slice().sort((a, b) => (b.layer || 0) - (a.layer || 0));
  el.innerHTML = gs.length ? gs.map((g) => `<div class="g"><div class="gh ${app.sel.g === g.id && !app.sel.p ? 'sel' : ''}" data-g="${g.id}"><button class="eye" data-vis="${g.id}" title="Показать/скрыть">${g.visible === false ? '○' : '●'}</button><span class="n">${esc(g.name)}</span><span class="chip">слой ${g.layer}</span><button class="eye" data-up="${g.id}" title="Слой выше">▲</button><button class="eye" data-dn="${g.id}" title="Слой ниже">▼</button></div>
    ${g.pieces.map((p) => `<div class="pc ${app.sel.p === p.id ? 'sel' : ''}" data-p="${p.id}"><button class="eye" data-pv="${p.id}">${p.hidden ? '○' : '●'}</button><span class="sw" style="width:12px;height:12px;background:${mats[p.mat]?.color || '#555'}"></span><span style="flex:1">${esc(p.name)}</span></div>
      ${(p.overlays || []).map((o) => `<div class="sub ${app.sel.overlay === o.id ? 'sel' : ''}" data-ov="${p.id}:${o.id}">▣ ${esc(o.name)}</div>`).join('')}${(p.prints || []).map((r) => `<div class="sub ${app.sel.print === r.id ? 'sel' : ''}" data-pr="${p.id}:${r.id}">▤ принт</div>`).join('')}`).join('')}</div>`).join('') : '<p class="note">Пока пусто — добавьте основу выше.</p>';
  el.onclick = (e) => {
    const t = e.target;
    const S = app.S;
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
    <dl class="kv"><dt>${r.isHide ? 'Площадь кожи' : 'Длина отреза'}</dt><dd>${r.isHide ? fmt(r.ft2, 1) + ' фт² → ' + r.hides + ' шк. (~' + r.hideFt2 + ' фт²)' : fmt(r.length / 100, 2) + ' м'}</dd><dt>Деталей</dt><dd>${r.placed.length}${r.placed.some((x) => x.fail) ? ' <span class="neg">· не влезли: ' + r.placed.filter((x) => x.fail).length + '</span>' : ''}</dd><dt>Усадка, компенс.</dt><dd>${r.mat.shrink ? r.mat.shrink[0] + '% / ' + r.mat.shrink[1] + '%' : '—'}</dd><dt>Ткань в изделии</dt><dd>${fmt(r.usedGrams, 0)} г</dd><dt>Отходы</dt><dd class="neg">${fmt(r.wasteGrams, 0)} г</dd></dl>
    ${r.offcuts.slice(0, 4).map((o) => `<div class="offc">остаток <b>${fmt(o.rect.w, 0)}×${fmt(o.rect.h, 0)} см</b> (${fmt(o.area / 100, 1)} дм²) → ${o.ideas.join('; ')}</div>`).join('')}</div>`).join('')}`;
  $('#lShr').onclick = () => { S.settings.shrinkComp = !S.settings.shrinkComp; app.scheduleLayout(); renderLeft(app); };
  $('#lRot').onclick = () => { S.settings.rotate = !S.settings.rotate; app.scheduleLayout(); renderLeft(app); };
  $('#lGap').onchange = (e) => { S.settings.gap = Math.max(0, +e.target.value); app.scheduleLayout(); };
  $('#lShow').onclick = () => setMode(app, 'layout');
  L.querySelectorAll('[data-w]').forEach((i) => (i.onchange = () => { const m = S.materials.find((x) => x.id === i.dataset.w); m.width = Math.max(20, +i.value); app.scheduleLayout(); }));
  L.querySelectorAll('[data-wopt]').forEach((b) => (b.onclick = () => {
    const m = S.materials.find((x) => x.id === b.dataset.wopt);
    const items = collectItems(S.garments, app.matsById()).find((x) => x.mat.id === m.id)?.items || [];
    const rows = [];
    for (const w of [90, 110, 120, 135, 140, 150, 160, 180]) { const r = nestMaterial(items, { ...m, width: w }, { shrink: S.settings.shrinkComp, rotate: S.settings.rotate, gap: S.settings.gap }); if (!r.placed.some((x) => x.fail)) rows.push([w, r]); }
    const best = rows.reduce((a, b) => (!a || b[1].util > a[1].util ? b : a), null);
    document.getElementById('wopt_' + m.id).innerHTML = `<table class="e"><tr><th>ширина</th><th>длина</th><th>исп.</th><th>отходы</th><th></th></tr>${rows.map(([w, r]) => `<tr${best && best[0] === w ? ' class="sel"' : ''}><td class="m">${w} см</td><td class="m">${fmt(r.length / 100, 2)} м</td><td class="m ${r.util >= 0.85 ? 'pos' : r.util < 0.72 ? 'neg' : ''}">${fmt(r.util * 100, 0)}%</td><td class="m neg">${fmt(r.wasteGrams, 0)} г</td><td><button class="sm ghost" data-setw="${w}">выбрать</button></td></tr>`).join('')}</table>`;
    document.getElementById('wopt_' + m.id).querySelectorAll('[data-setw]').forEach((x) => (x.onclick = () => { m.width = +x.dataset.setw; app.scheduleLayout(); }));
  }));
}

// ───────── right inspector ─────────
export function renderRight(app) {
  const R = $('#right');
  const S = app.S, sel = app.sel;
  if (sel.acc) return inspAcc(app, R, S.accessories.find((a) => a.id === sel.acc));
  if (sel.mat) return inspMat(app, R, S.materials.find((m) => m.id === sel.mat));
  const p = app.selPiece();
  if (p) return inspPiece(app, R, p);
  if (sel.g) return inspGarment(app, R, app.garment(sel.g));
  R.innerHTML = `<div class="sec"><h2>Инспектор</h2><p class="note">Выберите изделие, деталь, ткань или аксессуар. В 3D: клик — выбрать деталь, Alt+перетаскивание — потянуть ткань рукой.</p></div>
  <div class="sec"><h3>Быстрый старт</h3><ol class="steps-list"><li><b>Манекен</b> — задайте фигуру.</li><li><b>Изделия</b> — добавьте основы (ориентиры: удлинённый лонгслив, брюки с заниженной мотнёй, длинный кардиган).</li><li><b>Ткани</b> — состав и плотность меняют физику.</li><li><b>Детали</b> — разрежьте лекало на цветовые блоки, добавьте накладки, принты, фурнитуру.</li><li><b>Раскладка</b> — смотрите отходы и что сшить из остатков.</li></ol></div>`;
}

function inspGarment(app, R, g) {
  if (!g) { R.innerHTML = ''; return; }
  const P = GEN_PARAMS[g.gen] || [];
  const steps = sewingSteps(g);
  R.innerHTML = `<div class="sec"><h2>${esc(g.name)}</h2><div class="row"><input id="gName" value="${esc(g.name)}" style="flex:1"><button class="sm danger" id="gDel">Удалить</button></div>
  <p class="note">Параметры перестраивают лекала от мерок манекена (ручные правки этого изделия сбросятся; отмена — Ctrl+Z).</p>
  ${P.map(([k, n, mi, ma, st]) => ctl('gp_' + k, n, g.params[k], mi, ma, st)).join('')}</div>
  ${gradingHTML(g)}
  <div class="sec"><h3>Ткань всего изделия</h3><select id="gMat" style="width:100%">${app.S.materials.map((m) => `<option value="${m.id}" ${g.baseMat === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select><button class="sm" id="gMatAll" style="margin-top:6px">Назначить всем деталям</button></div>
  <div class="sec"><h3>Новая деталь</h3><div class="row"><input type="number" id="nw" value="20"> × <input type="number" id="nh" value="30"> см <select id="npl"><option value="front">на перед</option><option value="back">на спинку</option><option value="none">отдельно</option></select></div><button class="sm" id="nAdd">+ Прямоугольник</button><p class="note">Для геометрических zero-waste конструкций: прямоугольник шириной в рулон, клинья, ластовицы.</p></div>
  <div class="sec"><h3>Порядок пошива</h3><ol class="steps-list">${steps.map((s) => `<li><b>${s.title}</b><br>${s.seams.map((x) => { const sl = seamLengths(g, x); const ok = sl && Math.abs(sl.diff) < 0.35; return `<span class="${sl ? (ok || (x.name || '').includes('Втачивание') && Math.abs(sl.diff) < 2.2 ? 'pos' : 'neg') : ''}">${esc(x.name)}${sl ? ' · ' + fmt(sl.la) + (ok ? '' : ' / ' + fmt(sl.lb)) + ' см' : ''}</span>`; }).join('<br>')}</li>`).join('')}<li><b>Обработать</b> горловину, низ, края по припускам (см. стороны деталей)</li></ol></div>`;
  for (const [k, , , , st] of P) bindCtl('gp_' + k, (v, fin) => { g.params[k] = v; if (fin) app.regenerate(g); else app.regenDebounced(g); }, '', st < 1 ? 1 : 0);
  $('#gName').onchange = (e) => { g.name = e.target.value; renderTree(app); };
  $('#gDel').onclick = () => app.removeGarment(g);
  $('#gMat').onchange = (e) => { g.baseMat = e.target.value; };
  $('#gMatAll').onclick = () => { app.commit('Ткань изделия'); for (const p of g.pieces) p.mat = g.baseMat; app.changed({ allTex: true, geo: true, layout: true }); };
  $('#nAdd').onclick = () => app.addRectPiece(g, +$('#nw').value, +$('#nh').value, $('#npl').value);
  bindGrading(app, g);
}
function gradingHTML(g) {
  const gr = (g.grading ||= defaultGrading('M'));
  const sz = sizesOf(g);
  return `<div class="sec"><h3>Размерный ряд <span class="chip">${sz.join(' · ')}</span></h3>
  <div class="row"><label>Манекен = размер</label><select id="grBase">${SIZES.map((x) => `<option ${x === gr.base ? 'selected' : ''}>${x}</option>`).join('')}</select><label style="flex:0 0 auto"><input type="checkbox" id="grShow" ${gr.show ? 'checked' : ''}> веер</label></div>
  <div class="row" style="flex-wrap:wrap;gap:3px">${SIZES.map((x) => `<button class="sm ${sz.includes(x) ? 'on' : ''}" data-gsz="${x}" ${x === gr.base ? 'disabled' : ''}>${x}</button>`).join('')}</div>
  <p class="note">Градация переносит ваши правки (разрезы, накладки, изгибы) на все размеры: лекала соседних размеров строятся от мерок ± шаг.</p>
  <table class="e"><tr><th>шаг на размер</th><th>см</th></tr>${Object.entries(STEP_LABELS).map(([k, n]) => `<tr><td>${n}</td><td><input type="number" step="0.1" data-gstep="${k}" value="${gr.step[k] ?? 0}" style="width:56px"></td></tr>`).join('')}</table>
  <h3 style="margin-top:12px">Тираж для раскладки</h3>
  <table class="e"><tr>${sz.map((x) => `<th>${x}</th>`).join('')}</tr><tr>${sz.map((x) => `<td><input type="number" min="0" step="1" data-gq="${x}" value="${gr.qty?.[x] ?? 0}" style="width:34px"></td>`).join('')}</tr></table>
  <p class="note">Несколько размеров в одной раскладке обычно дают меньше отходов — детали заполняют пустоты друг друга.</p></div>`;
}
function bindGrading(app, g) {
  const gr = g.grading;
  const upd = (rerender = true) => { app.changed({ grade: true }); if (rerender) renderRight(app); };
  $('#grBase').onchange = (e) => { app.commit('Базовый размер'); const old = gr.base; gr.base = e.target.value; if (!gr.sizes.includes(old)) gr.sizes.push(old); if (gr.qty[old] && !gr.qty[gr.base]) { gr.qty[gr.base] = gr.qty[old]; delete gr.qty[old]; } upd(); };
  $('#grShow').onchange = (e) => { gr.show = e.target.checked; app.editor.dirty = true; };
  document.querySelectorAll('[data-gsz]').forEach((b) => (b.onclick = () => { const x = b.dataset.gsz; gr.sizes = gr.sizes.includes(x) ? gr.sizes.filter((y) => y !== x) : [...gr.sizes, x]; upd(); }));
  document.querySelectorAll('[data-gstep]').forEach((i) => (i.onchange = () => { gr.step[i.dataset.gstep] = +i.value; upd(false); }));
  document.querySelectorAll('[data-gq]').forEach((i) => (i.onchange = () => { gr.qty[i.dataset.gq] = Math.max(0, Math.round(+i.value)); upd(false); app.toast('Тираж обновлён — раскладка пересчитывается'); }));
}

function inspPiece(app, R, p) {
  const g = app.garmentOf(p);
  const mats = app.matsById();
  const sel = app.sel;
  const ov = sel.overlay ? p.overlays.find((o) => o.id === sel.overlay) : null;
  const pr = sel.print ? p.prints.find((o) => o.id === sel.print) : null;
  const co = cutOutline(p);
  const rows = p.corners.map((c, k) => {
    const m = p.meta[c.id] || {}, e = edgePts(p, k), L = polyLen(e), sm = seamOf(g, p.id, c.id);
    let badge = '<span class="muted">—</span>';
    if (sm) {
      const sl = seamLengths(g, sm);
      const other = sm.a.p === p.id && sm.a.e === c.id ? sm.b : sm.a;
      const op = g.pieces.find((x) => x.id === other.p);
      const d = sl ? (sm.a.p === p.id && sm.a.e === c.id ? sl.diff : -sl.diff) : 0;
      const ok = Math.abs(d) < 0.35 || ((sm.name || '').includes('Втачивание') && Math.abs(d) < 2.2);
      badge = `<span title="${esc(sm.name)} → ${esc(op?.name || '')}" class="${ok ? 'pos' : 'neg'}">${ok ? '✓' : 'Δ' + (d > 0 ? '+' : '') + fmt(d)}</span>`;
    }
    return `<tr class="${sel.edge === c.id ? 'sel' : ''}" data-edge="${c.id}"><td>${esc(m.name || 'сторона ' + (k + 1))}</td><td class="m">${fmt(L)}</td><td><input type="number" step="0.1" min="0" data-sa="${c.id}" value="${m.sa ?? 1}" ${m.raw ? 'disabled' : ''}></td><td><input type="checkbox" data-raw="${c.id}" ${m.raw ? 'checked' : ''} title="Сырой край"></td><td><input type="number" step="0.05" min="0.3" max="1" data-gat="${c.id}" value="${m.gather ?? 1}" title="Резинка: 1 — нет, 0.7 — стянуть до 70%"></td><td>${badge}</td></tr>`;
  }).join('');
  R.innerHTML = `<div class="sec"><h2>${esc(p.name)}</h2><div class="muted" style="font-size:11px;margin-bottom:8px">${esc(g?.name || '')}</div>
  <div class="row"><input id="pName" value="${esc(p.name)}" style="flex:1"></div>
  <div class="row"><label>Ткань</label><select id="pMat" style="flex:1">${app.S.materials.map((m) => `<option value="${m.id}" ${p.mat === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
  ${ctl('pGrain', 'Долевая нить, ° (45 — косой крой)', p.grain || 0, -90, 90, 1)}
  <div class="row"><label>Симметричная правка</label><button class="sm ${p.sym ? 'on' : ''}" id="pSym">${p.sym ? 'вкл' : 'выкл — асимметрия'}</button></div>
  <dl class="kv"><dt>Площадь</dt><dd>${fmt(Math.abs(area(p.pts)) / 100, 1)} дм² (с припусками ${fmt(Math.abs(area(co)) / 100, 1)})</dd><dt>Масса</dt><dd>${fmt((Math.abs(area(co)) / 1e4) * (mats[p.mat]?.gsm || 0), 0)} г</dd><dt>Габарит</dt><dd>${fmt(bbox(p.pts).w)} × ${fmt(bbox(p.pts).h)} см</dd></dl>
  <div class="row" style="flex-wrap:wrap"><button class="sm" id="pDup">Дублировать</button><button class="sm" id="pMir">Зеркальная копия</button><button class="sm danger" id="pDel">Удалить</button></div></div>
  <div class="sec"><h3>Стороны <span class="help-i" title="Припуск (см), сырой край, резинка (коэф. сборки), сверка длины шва: зелёный — совпадает, красный — расхождение">i</span></h3>
  <table class="e"><tr><th>сторона</th><th>длина</th><th>припуск</th><th>сыр.</th><th>рез.</th><th>шов</th></tr>${rows}</table></div>
  ${ov ? `<div class="sec"><h3>Накладка</h3><div class="row"><input id="oName" value="${esc(ov.name)}" style="flex:1"><button class="sm danger" id="oDel">×</button></div><div class="row"><label>Ткань</label><select id="oMat" style="flex:1">${app.S.materials.map((m) => `<option value="${m.id}" ${ov.mat === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div><div class="row"><label>Припуск, см</label><input type="number" step="0.1" id="oSa" value="${ov.sa ?? 1}"></div><p class="note">${fmt(Math.abs(area(ov.pts)) / 100, 1)} дм² · раскладывается отдельно</p></div>` : ''}
  ${pr ? `<div class="sec"><h3>Принт</h3>${ctl('rW', 'Ширина, см', pr.w, 1, 80, 0.5)}${ctl('rRot', 'Поворот, °', pr.rot || 0, -180, 180, 1)}${ctl('rOp', 'Непрозрачность', pr.opacity ?? 1, 0.05, 1, 0.05)}<div class="row"><label>Смешивание</label><select id="rBl"><option value="">обычное</option><option value="multiply" ${pr.blend === 'multiply' ? 'selected' : ''}>умножение (впитался)</option><option value="screen" ${pr.blend === 'screen' ? 'selected' : ''}>экран (светлый)</option></select></div><button class="sm danger" id="rDel">Удалить принт</button></div>` : ''}
  ${(p.hardware || []).length ? `<div class="sec"><h3>Фурнитура · ${p.hardware.length}</h3><button class="sm danger" id="hClr">Убрать всю фурнитуру детали</button></div>` : ''}
  ${(p.strokes || []).length ? `<div class="sec"><h3>Рисунок кистью · ${p.strokes.length}</h3><button class="sm" id="sUndo">Убрать последний штрих</button> <button class="sm danger" id="sClr">Очистить</button></div>` : ''}`;
  $('#pName').onchange = (e) => { p.name = e.target.value; app.changed({}); };
  $('#pMat').onchange = (e) => { app.commit('Ткань детали'); p.mat = e.target.value; app.changed({ tex: [p.id], geo: true, layout: true }); };
  bindCtl('pGrain', (v, fin) => { if (fin) { app.commit('Нить'); p.grain = v; app.changed({ geo: true, tex: [p.id], layout: true }); } else { p.grain = v; app.editor.dirty = true; } }, '°', 0);
  $('#pSym').onclick = () => { p.sym = !p.sym; renderRight(app); };
  $('#pDup').onclick = () => { app.commit('Дублировать'); const c = duplicatePiece(g, p, false); app.updateTex([c.id]); app.select({ p: c.id }); app.changed({ geo: true, layout: true }); };
  $('#pMir').onclick = () => { app.commit('Зеркальная копия'); const c = duplicatePiece(g, p, true); app.updateTex([c.id]); app.select({ p: c.id }); app.changed({ geo: true, layout: true }); };
  $('#pDel').onclick = () => deleteSelected(app, true);
  R.querySelectorAll('[data-edge]').forEach((tr) => (tr.onclick = (e) => { if (e.target.tagName === 'INPUT') return; app.select({ g: g.id, p: p.id, edge: tr.dataset.edge }); }));
  R.querySelectorAll('[data-sa]').forEach((i) => (i.onchange = () => { app.commit('Припуск'); p.meta[i.dataset.sa].sa = Math.max(0, +i.value); app.changed({ layout: true }); }));
  R.querySelectorAll('[data-raw]').forEach((i) => (i.onchange = () => { app.commit('Сырой край'); p.meta[i.dataset.raw].raw = i.checked; app.changed({ tex: [p.id], layout: true }); }));
  R.querySelectorAll('[data-gat]').forEach((i) => (i.onchange = () => { app.commit('Резинка'); p.meta[i.dataset.gat].gather = Math.min(1, Math.max(0.3, +i.value)); app.changed({ geo: true }); }));
  if (ov) {
    $('#oName').onchange = (e) => { ov.name = e.target.value; app.changed({}); };
    $('#oDel').onclick = () => { app.commit('Удалить накладку'); p.overlays = p.overlays.filter((x) => x !== ov); app.select({ p: p.id }); app.changed({ tex: [p.id], layout: true }); };
    $('#oMat').onchange = (e) => { app.commit('Ткань накладки'); ov.mat = e.target.value; app.changed({ tex: [p.id], layout: true }); };
    $('#oSa').onchange = (e) => { ov.sa = +e.target.value; app.changed({ layout: true }); };
  }
  if (pr) {
    const t = (v, fin) => { if (fin) app.changed({ tex: [p.id] }); else app.liveTex(p); app.editor.dirty = true; };
    bindCtl('rW', (v, f) => { pr.w = v; t(v, f); }); bindCtl('rRot', (v, f) => { pr.rot = v; t(v, f); }, '°', 0); bindCtl('rOp', (v, f) => { pr.opacity = v; t(v, f); }, '', 2);
    $('#rBl').onchange = (e) => { pr.blend = e.target.value || null; app.changed({ tex: [p.id] }); };
    $('#rDel').onclick = () => { app.commit('Удалить принт'); p.prints = p.prints.filter((x) => x !== pr); app.select({ p: p.id }); app.changed({ tex: [p.id] }); };
  }
  if ($('#hClr')) $('#hClr').onclick = () => { app.commit('Фурнитура'); p.hardware = []; app.changed({ hw: true }); };
  if ($('#sUndo')) $('#sUndo').onclick = () => { app.commit('Кисть'); p.strokes.pop(); app.changed({ tex: [p.id] }); };
  if ($('#sClr')) $('#sClr').onclick = () => { app.commit('Кисть'); p.strokes = []; app.changed({ tex: [p.id] }); };
}

function inspMat(app, R, m) {
  if (!m) { R.innerHTML = ''; return; }
  const d = describe(m), ph = d.ph;
  const fiberOpts = (sel) => Object.entries(FIBERS).map(([k, f]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${f.n}</option>`).join('');
  const tot = m.comp.reduce((a, [, p]) => a + +p, 0);
  const used = app.S.garments.reduce((a, g) => a + g.pieces.filter((p) => p.mat === m.id).length, 0);
  R.innerHTML = `<div class="sec"><h2>${esc(m.name)}</h2><div class="row"><input id="mName" value="${esc(m.name)}" style="flex:1"><input type="color" id="mCol" value="${m.color}"></div>
  <div class="row"><label>Переплетение</label><select id="mCons" style="flex:1">${Object.entries(CONS).map(([k, c]) => `<option value="${k}" ${k === m.cons ? 'selected' : ''}>${c.n}</option>`).join('')}</select></div>
  <div class="row"><label>Плотность, г/м²</label><input type="number" id="mGsm" value="${m.gsm}"></div>
  ${m.thick || CONS[m.cons]?.hide ? `<div class="row"><label>Толщина кожи, мм</label><input type="number" step="0.1" id="mThk" value="${m.thick || 1}"></div>` : ''}
  <div class="row"><label>Ширина, см</label><input type="number" id="mWid" value="${m.width}"></div>
  <div class="row"><label>Обработка</label><select id="mFin" style="flex:1">${Object.entries(FINISHES).map(([k, n]) => `<option value="${k}" ${k === m.finish ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
  <div class="row"><label>Цена, ₽/${CONS[m.cons]?.hide ? 'фут²' : 'м'}</label><input type="number" id="mPr" value="${m.price}"></div></div>
  <div class="sec"><h3>Состав <span class="${tot === 100 ? 'pos' : 'neg'}">${tot}%</span></h3>
  ${m.comp.map(([f, p], i) => `<div class="comp"><select data-cf="${i}">${fiberOpts(f)}</select><input type="number" data-cp="${i}" value="${p}" min="0" max="100"><button class="sm ghost" data-cx="${i}">×</button></div>`).join('')}
  <button class="sm" id="cAdd">+ волокно</button><p class="note">Напр.: хлопок 90% + эластан 10% — эластан резко увеличивает растяжимость по утку и усадку.</p></div>
  <div class="sec"><h3>Физика (выводится из состава)</h3><dl class="kv"><dt>Драпируемость</dt><dd>${d.drape} (${fmt(ph.drape, 2)})</dd><dt>Растяжимость</dt><dd>${d.stretch}</dd><dt>Толщина</dt><dd>${fmt(ph.thick * 10, 2)} мм</dd><dt>Трение</dt><dd>${fmt(ph.fric, 2)}</dd><dt>Блеск</dt><dd>${fmt(ph.sheen, 2)}</dd></dl>
  ${ctl('fxB', 'Жёсткость на изгиб ×', (m.phys?.bendK ?? 1), 0.1, 5, 0.05)}${ctl('fxS', 'Растяжимость ×', (m.phys?.stretchK ?? 1), 0.1, 4, 0.05)}
  <div class="row"><label>Усадка, % (длина / ширина)</label><input type="number" step="0.1" id="shL" value="${m.shrink?.[0] ?? 0}"><input type="number" step="0.1" id="shW" value="${m.shrink?.[1] ?? 0}"></div><button class="sm" id="shAuto">Рассчитать по составу и обработке</button>
  <p class="note">Используется деталей: ${used}. Изменение ткани сразу меняет поведение в 3D и расход.</p>
  <button class="sm" id="mApply">Назначить выбранной детали</button></div>`;
  const ch = (label, fn, geo = true) => { app.commit(label); fn(); app.changed({ mats: geo, allTex: !geo, layout: true }); renderRight(app); };
  $('#mName').onchange = (e) => { m.name = e.target.value; renderRight(app); if (app.tab === 'materials') renderLeft(app); };
  $('#mCol').oninput = (e) => { m.color = e.target.value; app.liveTex && app.S.garments.forEach((g) => g.pieces.forEach((p) => { if (p.mat === m.id) app.liveTex(p); })); };
  $('#mCol').onchange = () => { app.commit('Цвет'); app.changed({ allTex: true }); if (app.tab === 'materials') renderLeft(app); app.rebuildAccessories(); };
  $('#mCons').onchange = (e) => ch('Переплетение', () => { m.cons = e.target.value; });
  $('#mGsm').onchange = (e) => ch('Плотность', () => { m.gsm = Math.max(10, +e.target.value); });
  if ($('#mThk')) $('#mThk').onchange = (e) => ch('Толщина', () => { m.thick = +e.target.value; });
  $('#mWid').onchange = (e) => { m.width = Math.max(20, +e.target.value); app.scheduleLayout(); };
  $('#mFin').onchange = (e) => ch('Обработка', () => { m.finish = e.target.value; m.shrink = defaultShrink(m); });
  $('#mPr').onchange = (e) => { m.price = +e.target.value; app.scheduleLayout(); };
  R.querySelectorAll('[data-cf]').forEach((s) => (s.onchange = () => ch('Состав', () => { m.comp[+s.dataset.cf][0] = s.value; })));
  R.querySelectorAll('[data-cp]').forEach((s) => (s.onchange = () => ch('Состав', () => { m.comp[+s.dataset.cp][1] = Math.max(0, Math.min(100, +s.value)); })));
  R.querySelectorAll('[data-cx]').forEach((s) => (s.onclick = () => ch('Состав', () => { if (m.comp.length > 1) m.comp.splice(+s.dataset.cx, 1); })));
  $('#cAdd').onclick = () => ch('Состав', () => { m.comp.push(['elastane', 5]); const first = m.comp[0]; first[1] = Math.max(0, first[1] - 5); });
  const phx = (key, v, fin) => { m.phys = { ...(m.phys || {}) }; m.phys[key] = v; const base = physics({ ...m, phys: {} }); if (key === 'bendK') m.phys.bend = base.bend * v; if (key === 'stretchK') { m.phys.warp = base.warp * v; m.phys.weft = base.weft * v; m.phys.bias = base.bias * v; } if (fin) { app.changed({ mats: true }); } };
  bindCtl('fxB', (v, f) => phx('bendK', v, f), '', 2); bindCtl('fxS', (v, f) => phx('stretchK', v, f), '', 2);
  $('#shL').onchange = (e) => { m.shrink = [+e.target.value, m.shrink?.[1] ?? 0]; app.scheduleLayout(); };
  $('#shW').onchange = (e) => { m.shrink = [m.shrink?.[0] ?? 0, +e.target.value]; app.scheduleLayout(); };
  $('#shAuto').onclick = () => { m.shrink = defaultShrink(m); app.scheduleLayout(); renderRight(app); };
  $('#mApply').onclick = () => {
    const pid = app._lastPiece;
    const f = pid && findPiece(app.S.garments, pid);
    if (!f) { app.toast('Сначала выберите деталь, затем ткань', 'neg'); return; }
    app.commit('Ткань детали'); f.p.mat = m.id; app.changed({ tex: [f.p.id], geo: true, layout: true }); app.toast('Назначено: ' + f.p.name, 'pos');
  };
}

function inspAcc(app, R, a) {
  if (!a) { R.innerHTML = ''; return; }
  const T = ACC_TYPES[a.type];
  R.innerHTML = `<div class="sec"><h2>${esc(a.name)}</h2><div class="row"><input id="aName" value="${esc(a.name)}" style="flex:1"><button class="sm danger" id="aDel">Удалить</button></div>
  ${T.params.map(([k, n, ...rest]) => Array.isArray(rest[0]) ? `<div class="row"><label>${n}</label><select data-ap="${k}" style="flex:1">${rest.map(([v, l]) => `<option value="${v}" ${a.p[k] === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ctl('ap_' + k, n, a.p[k], rest[0], rest[1], rest[2])).join('')}
  ${a.type !== 'chain' ? `<div class="row"><label>Материал</label><select id="aMat" style="flex:1">${app.S.materials.map((m) => `<option value="${m.id}" ${a.mat === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>` : ''}
  ${a.type === 'shoes' ? `<div class="row"><label>Цвет подошвы</label><input type="color" id="aSole" value="${a.p.soleColor || '#e9e5dc'}"></div>` : ''}
  ${['belt', 'chain', 'bag'].includes(a.type) ? `<div class="row"><label>Металл</label><select id="aMet">${Object.entries(METALS).map(([k, v]) => `<option value="${k}" ${a.metal === k ? 'selected' : ''}>${v.n}</option>`).join('')}</select></div>` : ''}
  <p class="note">${a.type === 'belt' ? 'Ремень со «стягивает ткань» = 1 работает в физике: ткань под ним собирается.' : a.type === 'shoes' ? 'Брюки ложатся на обувь: голенище и стопа — коллайдеры для ткани.' : 'Параметры обновляются сразу.'}</p></div>`;
  const re = () => { app.rebuildAccessories(); app.autosave(); };
  for (const [k, , ...rest] of T.params) if (!Array.isArray(rest[0])) bindCtl('ap_' + k, (v, fin) => { a.p[k] = v; if (fin) { app.commit('Аксессуар'); } re(); }, '', rest[2] < 1 ? 1 : 0);
  R.querySelectorAll('[data-ap]').forEach((s) => (s.onchange = () => { app.commit('Аксессуар'); a.p[s.dataset.ap] = s.value; re(); }));
  if ($('#aMat')) $('#aMat').onchange = (e) => { app.commit('Аксессуар'); a.mat = e.target.value; re(); };
  if ($('#aSole')) $('#aSole').oninput = (e) => { a.p.soleColor = e.target.value; re(); };
  if ($('#aMet')) $('#aMet').onchange = (e) => { a.metal = e.target.value; re(); };
  $('#aName').onchange = (e) => { a.name = e.target.value; renderLeft(app); };
  $('#aDel').onclick = () => { app.commit('Удалить аксессуар'); app.S.accessories = app.S.accessories.filter((x) => x !== a); app.select({}); re(); renderLeft(app); };
}

function deleteSelected(app, force) {
  const p = app.selPiece();
  if (!p) return;
  const g = app.garmentOf(p);
  if (app.sel.overlay && !force) { app.commit('Удалить накладку'); p.overlays = p.overlays.filter((o) => o.id !== app.sel.overlay); app.select({ p: p.id }); app.changed({ tex: [p.id], layout: true }); return; }
  if (app.sel.print && !force) { app.commit('Удалить принт'); p.prints = p.prints.filter((o) => o.id !== app.sel.print); app.select({ p: p.id }); app.changed({ tex: [p.id] }); return; }
  app.commit('Удалить деталь');
  g.pieces = g.pieces.filter((x) => x !== p);
  g.seams = g.seams.filter((s) => s.a.p !== p.id && s.b.p !== p.id);
  app.select({ g: g.id });
  app.changed({ geo: true, layout: true });
}

// ───────── footer ─────────
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

// ───────── layout view ─────────
export function drawLayout(app) {
  const wrap = $('#layoutView'), cv = $('#cLay');
  const res = app.layout || [];
  const W = wrap.clientWidth - 24;
  const maxLen = Math.max(100, ...res.map((r) => r.length));
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
    c.fillStyle = '#6d6961'; c.font = '9px "JetBrains Mono", monospace';
    for (let u = 0; u <= r.length; u += 50) { c.fillRect(u * sc, r.W * sc, 1, 4); c.fillText(u + '', u * sc + 2, r.W * sc + 12); }
    c.restore();
    y += r.W * sc + 40;
  }
}

// ───────── exports ─────────
function doExport(app, kind) {
  const S = app.S;
  $('#menu').style.display = 'none';
  if (kind === 'json') app.save('kromka-proekt.json', JSON.stringify({ app: 'kromka', v: 1, body: S.body, materials: S.materials, garments: S.garments, accessories: S.accessories, images: S.images, settings: S.settings }));
  if (kind === 'open') document.getElementById('fileProj').click();
  if (kind === 'png') { const d = app.view3d.snapshotPNG(); fetch(d).then((r) => r.blob()).then((b) => app.save('kromka-3d.png', b)); }
  if (kind === 'svg') app.save('kromka-lekala.svg', exportSVG(app));
  if (kind === 'prod') openExport(app);
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

const HELP = `<h1>КРОМКА</h1><p style="color:var(--tx3);font:11px var(--mono);letter-spacing:.08em">3D-КОНСТРУКТОР ОДЕЖДЫ · ЛЕКАЛА · ФИЗИКА ТКАНЕЙ · РАСКЛАДКА БЕЗ ОТХОДОВ</p>
<div class="cols"><div><h4>Как работать</h4><ol><li><b>Манекен.</b> Пол, рост, вес, % жира → мерки. Любую мерку можно вписать вручную.</li><li><b>Изделия.</b> Добавьте основу. Параметры справа (свобода, спуск плеча, длина, асимметрия низа, заниженная мотня…) перестраивают лекала.</li><li><b>Ткани.</b> Состав (напр. хлопок 90% + эластан 10%), плотность, переплетение и обработка определяют драпировку, растяжение по основе/утку/косой и усадку.</li><li><b>Детали.</b> Режьте лекала кривой или от руки — части станут отдельными деталями со швом. Накладки, принты (PNG), кисть, фурнитура, сырые края, резинки.</li><li><b>Раскладка.</b> Живой расчёт расхода и отходов на ширине рулона с компенсацией усадки; подсказки, что сшить из остатков.</li></ol></div>
<div><h4>Лекала</h4><p>Сплошная линия — шов, пунктир — линия кроя с припуском. У каждой стороны: длина, буква шва и сверка длины: <span class="pos">✓ совпадает</span>, <span class="neg">Δ расхождение</span>. Цветная надсечка — место совмещения.</p><h4>3D</h4><p>Клик — выбрать деталь. <kbd>Alt</kbd>+перетаскивание — потянуть ткань рукой. Кисть рисует прямо по модели. «Натяжение» — красным перетянутые зоны.</p><h4>Клавиши</h4><p><kbd>V</kbd> выбор <kbd>P</kbd> точка <kbd>C</kbd> разрез кривой <kbd>F</kbd> от руки <kbd>O</kbd> накладка <kbd>B</kbd> кисть <kbd>I</kbd> принт <kbd>H</kbd> фурнитура <kbd>S</kbd> шов · <kbd>Ctrl+Z</kbd> отмена · <kbd>Del</kbd> удалить · пробел+мышь — панорама</p></div></div>
<p style="margin-top:18px"><button data-close>Понятно</button></p>`;
void TOOLS; void edgeK; void uid; void measure;

// ───────── production export dialog ─────────
function openExport(app) {
  let dlg = document.getElementById('dlg');
  if (!dlg) { dlg = document.createElement('div'); dlg.id = 'dlg'; document.body.appendChild(dlg); }
  const gs = app.S.garments.filter((g) => g.visible !== false);
  const allSizes = SIZES.filter((x) => gs.some((g) => sizesOf(g).includes(x)));
  const bases = new Set(gs.map((g) => g.grading?.base || 'M'));
  dlg.innerHTML = `<div class="box"><h2 style="margin:0 0 4px">Лекала для производства</h2><p class="note">Все форматы — масштаб 1:1, с припусками, нитью, надсечками и подписями деталей.</p>
  <h4>Формат</h4><div class="list">
  <label class="card"><input type="radio" name="fmt" value="pdf" checked><div><div class="t">PDF · листы А4 для печати</div><div class="s">склейка по крестикам, номера листов, контрольная линейка 10 см на каждом листе</div></div></label>
  <label class="card"><input type="radio" name="fmt" value="dxf"><div><div class="t">ZIP · DXF-AAMA + PLT (HPGL)</div><div class="s">для плоттера, раскройного комплекса и CAD (Gerber, Lectra, Optitex, Valentina); единицы — мм</div></div></label>
  <label class="card"><input type="radio" name="fmt" value="svg"><div><div class="t">SVG · веер размеров</div><div class="s">все размеры наложены друг на друга — проверка градации, печать на плоттере</div></div></label></div>
  <h4>Изделия</h4><div class="row" style="flex-wrap:wrap">${gs.map((g) => `<label style="margin-right:10px"><input type="checkbox" data-xg="${g.id}" checked> ${esc(g.name)}</label>`).join('')}</div>
  <h4>Размеры</h4><div class="row" style="flex-wrap:wrap">${allSizes.map((x) => `<label style="margin-right:8px"><input type="checkbox" data-xs="${x}" ${bases.has(x) ? 'checked' : ''}> ${x}</label>`).join('')}</div>
  <div class="row" style="margin-top:14px;justify-content:flex-end"><span id="xInfo" class="muted" style="flex:1;font-size:12px"></span><button data-xclose>Отмена</button><button class="on" id="xGo">Сохранить</button></div></div>`;
  dlg.style.display = 'flex';
  dlg.onclick = (e) => { if (e.target === dlg || e.target.closest('[data-xclose]')) dlg.style.display = 'none'; };
  const info = () => {
    const garments = [...dlg.querySelectorAll('[data-xg]:checked')].map((i) => i.dataset.xg), sizes = [...dlg.querySelectorAll('[data-xs]:checked')].map((i) => i.dataset.xs);
    const sets = exportSets(app, { garments, sizes });
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
    const tag = [...new Set(sets.map((s) => s.size))].join('-');
    if (fmtSel === 'pdf') {
      app.toast('Готовлю листы А4…');
      await new Promise((r) => setTimeout(r, 30));
      const r = await pdfTiles(app, sets);
      app.toast(`PDF: ${r.pages} лист(ов), сетка ${r.rows}×${r.cols}`, 'pos');
      app.save(`kromka-lekala-A4-${tag}.pdf`, r.blob);
    } else if (fmtSel === 'dxf') {
      const z = zip([{ name: `kromka-${tag}.dxf`, data: dxf(app, sets) }, { name: `kromka-${tag}.plt`, data: plt(app, sets) }, { name: 'README.txt', data: 'КРОМКА — экспорт лекал\r\nDXF: формат AutoCAD R12, блоки по ASTM D6673 (AAMA): слой 1 — линия кроя, 14 — линия шва, 7 — нить, 4 — надсечки, 8 — накладки, 15 — подписи. Единицы — миллиметры.\r\nPLT: HPGL, 40 ед./мм, перо 1 — крой, перо 2 — шов.\r\n' }]);
      app.save(`kromka-lekala-${tag}.zip`, z);
    } else {
      app.save(`kromka-vеer-${tag}.svg`.replace('vеer', 'veer'), svgNest(app, sets));
    }
    dlg.style.display = 'none';
  };
}
