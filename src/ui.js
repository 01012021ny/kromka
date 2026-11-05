// UI entry: header, 3D bar, hotkeys, splitter; panels live in ./ui/
import { $ } from './ui/controls.js';
import { doExport } from './ui/exports.js';
import { HELP } from './ui/help.js';
import { deleteSelected } from './ui/inspector.js';
import { renderLeft } from './ui/left.js';
import { TOOLS, renderTools, setTool, setMode } from './ui/toolbar.js';

export { setTool } from './ui/toolbar.js';
export { renderLeft, renderBodyReadout, renderTree } from './ui/left.js';
export { renderRight } from './ui/inspector.js';
export { renderStats, renderWaste } from './ui/status.js';
export { drawLayout } from './ui/layoutview.js';

const TABS = [['body', 'Манекен'], ['garments', 'Изделия'], ['materials', 'Ткани'], ['details', 'Детали'], ['acc', 'Обувь и аксессуары'], ['layout', 'Раскладка']];

export function init(app) {
  // steps
  const nav = $('#steps');
  nav.innerHTML = TABS.map(([id, n], i) => `<button data-tab="${id}"><i>0${i + 1}</i>${n}</button>`).join('');
  nav.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; app.tab = b.dataset.tab; if (app.tab === 'layout') setMode(app, 'layout'); else if (app.mode2d === 'layout') setMode(app, 'pattern'); renderLeft(app); });
  // tools
  renderTools(app);
  // 3D bar
  $('#bPlay').onclick = () => { app.sim.running = !app.sim.running; if (app.sim.running) app.sim.wake(); app.updatePlay(); };
  $('#bResew').onclick = () => { app.rebuildSim(true); app.toast('Изделия заново надеты и сшиты из лекал'); };
  $('#bGrab').onclick = (e) => { app.grabMode = !app.grabMode; e.target.classList.toggle('on', app.grabMode); app.toast(app.grabMode ? 'Тяните ткань мышью — она живёт по физике; камера — перетаскиванием мимо ткани' : 'Режим «тянуть ткань» выключен'); };
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
    ['passport', 'Паспорт образца', 'для выбранного изделия: детали, расход, порядок пошива, табель мер для калибровки'],
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
  // боковые панели: скрыть / показать (× в углу, полоска у края, клавиши [ и ])
  try { app.panels = JSON.parse(localStorage.getItem('kromka.panels') || 'null') || { l: true, r: true }; } catch (e) { app.panels = { l: true, r: true }; }
  const panels = () => {
    const el = $('#app');
    el.classList.toggle('noL', !app.panels.l); el.classList.toggle('noR', !app.panels.r);
    try { localStorage.setItem('kromka.panels', JSON.stringify(app.panels)); } catch (e) { /* приватный режим */ }
    app.view3d.invalidate(4); app.editor.dirty = true;
  };
  app.togglePanel = (k, on) => { app.panels[k] = on ?? !app.panels[k]; panels(); };
  $('#lClose').onclick = () => app.togglePanel('l', false); $('#lOpen').onclick = () => app.togglePanel('l', true);
  $('#rClose').onclick = () => app.togglePanel('r', false); $('#rOpen').onclick = () => app.togglePanel('r', true);
  panels();
  // keys
  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input,textarea,select')) return;
    // по коду клавиши — работает и в русской раскладке (х / ъ)
    if (!e.ctrlKey && !e.metaKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) { app.togglePanel(e.code === 'BracketLeft' ? 'l' : 'r'); return; }
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

function showHelp(on) { $('#help').style.display = on ? 'flex' : 'none'; }
