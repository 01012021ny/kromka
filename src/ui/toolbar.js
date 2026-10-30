// 2D toolbar: tools, pattern/layout mode
import { $ } from './controls.js';
import { drawLayout } from './layoutview.js';
import { renderLeft } from './left.js';

export const TOOLS = [
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

export function renderTools(app) {
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
export function setMode(app, m) {
  app.mode2d = m;
  $('#layoutView').style.display = m === 'layout' ? 'block' : 'none';
  $('#v2d').style.display = m === 'layout' ? 'none' : 'block';
  renderTools(app);
  if (m === 'layout') drawLayout(app); else { app.editor.resize(); app.editor.dirty = true; }
}
