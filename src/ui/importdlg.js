// Диалог импорта лекал (PDF, SVG, DXF): найденные детали с превью, единицы, выбор; итог — новое изделие.
import { importPatternFile, UNITS, UNIT_NAMES } from '../importer.js';
import { esc, fmt } from '../util.js';
import { $ } from './controls.js';

export function pickImportFile() { document.getElementById('fileImp')?.click(); }

/** превью контура в SVG (y вверх) */
function thumb(it, size = 92) {
  const b = it.cut || it.outline, xs = b.map((q) => q[0]), ys = b.map((q) => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), k = (size - 8) / Math.max(x1 - x0, y1 - y0, 1);
  const path = (pts) => 'M' + pts.map((q) => `${((q[0] - x0) * k + 4).toFixed(1)},${(size - 4 - (q[1] - y0) * k).toFixed(1)}`).join('L') + 'Z';
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${it.cut && it.sa ? `<path d="${path(it.cut)}" fill="none" stroke="#6b6b73" stroke-width="1" stroke-dasharray="3 2"/>` : ''}<path d="${path(it.outline)}" fill="rgba(217,208,190,.12)" stroke="#d9d0be" stroke-width="1.2"/></svg>`;
}

/** открыть файл: разобрать и показать диалог */
export async function importFromFile(app, file) {
  const data = new Uint8Array(await file.arrayBuffer());
  let res;
  try { res = await importPatternFile(file.name, data); } catch (e) { app.toast('Не удалось прочитать файл: ' + (e.message || e), 'neg'); return; }
  showDialog(app, file.name, data, res);
}

function showDialog(app, name, data, res) {
  let dlg = document.getElementById('dlg');
  if (!dlg) { dlg = document.createElement('div'); dlg.id = 'dlg'; document.body.appendChild(dlg); }
  const sel = res.pieces.map((p) => !p.test);
  const units = Object.keys(UNIT_NAMES).filter((u) => u !== 'pt' || res.unit === 'pt');
  const render = () => {
    const n = sel.filter(Boolean).length;
    dlg.innerHTML = `<div class="box imp"><h2 style="margin:0 0 4px">Импорт лекал · ${esc(name)}</h2>
    <p class="note">Найдено контуров деталей: ${res.pieces.length}. Если внутри контура реза есть линия шва, деталь берётся по ней, а припуск считается по расстоянию между линиями (пунктир на превью — линия реза).</p>
    ${res.warn.map((w) => `<p class="note neg">${esc(w)}</p>`).join('')}
    <div class="row"><label>Единицы файла</label><select id="impU">${units.map((u) => `<option value="${u}" ${u === res.unit ? 'selected' : ''}>${UNIT_NAMES[u]}${u === res.unit ? (res.unitFromFile ? ' — из файла' : ' — по размеру деталей') : ''}</option>`).join('')}</select></div>
    <div class="imp-grid">${res.pieces.map((p, i) => `<label class="card imp-c ${sel[i] ? 'on' : ''}"><input type="checkbox" data-ii="${i}" ${sel[i] ? 'checked' : ''}>${thumb(p)}<div class="t">Деталь ${i + 1}</div>
      <div class="s">${fmt(p.w)} × ${fmt(p.h)} см${p.sa ? ` · припуск ${fmt(p.sa)}` : ' · контур — линия реза'}${p.test ? ' · <span class="neg">похоже на контрольный квадрат</span>' : ''}</div></label>`).join('') || '<p class="note">Нечего импортировать.</p>'}</div>
    <p class="note">После импорта детали лежат «отдельно» (только крой). Чтобы надеть на манекен: выберите деталь → «Место на манекене» (перед, спинка, рукав, брючина), при необходимости поверните или разверните половинку по сгибу, затем сшейте стороны инструментом «Шов» (S).</p>
    <div class="row" style="justify-content:flex-end;gap:8px;margin-top:10px"><button class="ghost" id="impX">Отмена</button><button id="impGo" ${n ? '' : 'disabled'}>Добавить деталей: ${n}</button></div></div>`;
    dlg.style.display = 'flex';
    $('#impX').onclick = () => (dlg.style.display = 'none');
    dlg.onclick = (e) => { if (e.target === dlg) dlg.style.display = 'none'; };
    dlg.querySelectorAll('[data-ii]').forEach((c) => (c.onchange = () => { sel[+c.dataset.ii] = c.checked; render(); }));
    $('#impU').onchange = async (e) => {
      const u = e.target.value;
      res = await importPatternFile(name, data, u);
      sel.length = 0; res.pieces.forEach((p) => sel.push(!p.test));
      render();
    };
    $('#impGo').onclick = () => {
      dlg.style.display = 'none';
      app.addImported(name, res.pieces.filter((_, i) => sel[i]).map((p, i) => ({ ...p, name: `Деталь ${i + 1}` })));
    };
  };
  render();
  void UNITS;
}
