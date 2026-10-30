// Right inspector: garment, piece, material, accessory
import { GEN_PARAMS, edgePts, seamOf, seamLengths, sewingSteps, duplicatePiece, cutOutline, findPiece } from '../patterns.js';
import { FIBERS, CONS, FINISHES, describe, defaultShrink, physics } from '../materials.js';
import { ACC_TYPES, METALS } from '../accessories.js';
import { esc, fmt, polyLen, bbox, area } from '../util.js';
import { SIZES, STEP_LABELS, defaultGrading, sizesOf } from '../grading.js';
import { $, ctl, bindCtl } from './controls.js';
import { renderLeft, renderTree } from './left.js';

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

export function deleteSelected(app, force) {
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
