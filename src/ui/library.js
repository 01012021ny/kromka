// Окно библиотеки лекал: поиск, фильтры, карточки, образы, открытые источники.
// Во вкладке 02 остаётся быстрый доступ — недавно использованные шаблоны (recent*).
import { LIBRARY, DESIGNERS, OUTFITS, OPEN_SOURCES, searchLibrary, facets, outfitsFor, matGroup, findItem } from '../library.js';
import { PRESETS } from '../materials.js';
import { esc } from '../util.js';
import { $ } from './controls.js';

const GEN_LABEL = { top: 'плечевое', pants: 'поясное · брюки', skirt: 'поясное · юбка', snood: 'аксессуар из ткани' };
export const LEVEL = (n) => '●'.repeat(n) + '○'.repeat(3 - n);
const FACETS = [['cat', 'Категория'], ['style', 'Ассоциации: дизайнеры и бренды'], ['sil', 'Силуэт'], ['mat', 'Ткань'], ['level', 'Сложность']];
const swatch = (id) => PRESETS.find((x) => x.id === id)?.color || '#555';
const dname = (id) => DESIGNERS.find((d) => d.id === id)?.n || id;

// ── недавние шаблоны (на устройстве, не в проекте)
const RECENT_KEY = 'kromka.recent', RECENT_MAX = 8;
/** @returns {string[]} id карточек, последние — первыми */
export function recentIds() {
  try { const a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(a) ? a.filter((id) => findItem(id)) : []; } catch (e) { return []; }
}
export function pushRecent(ids) {
  const cur = recentIds();
  for (const id of [].concat(ids).reverse()) { const i = cur.indexOf(id); if (i >= 0) cur.splice(i, 1); cur.unshift(id); }
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, RECENT_MAX))); } catch (e) { /* приватный режим */ }
}
/** первые шаги: пока ничего не использовалось — базовые шаблоны */
const STARTERS = ['tee', 'jeans', 'trou', 'skirt', 'long', 'coat'];
export const quickIds = () => { const r = recentIds(); return r.length ? r : STARTERS; };

/** карточка шаблона: компактная (быстрый доступ) или полная (окно библиотеки) */
export function cardHTML(p, full = false) {
  const st = (p.style || []).map(dname);
  return `<div class="card${full ? ' big' : ''}" data-add="${p.id}" title="${esc(p.note || '')}"><div class="sw" style="background:${swatch(p.mat)}"></div><div style="flex:1;min-width:0"><div class="t">${esc(p.name)}</div>
    <div class="s">${esc(p.sil || GEN_LABEL[p.gen])} · ${esc(matGroup(p.mat))} · <span class="lv" title="Сложность">${LEVEL(p.level || 1)}</span>${p.decor ? ' · детали' : ''}</div>
    ${st.length ? `<div class="as">${esc(st.join(' · '))}</div>` : ''}${full && p.note ? `<div class="nt">${esc(p.note)}</div>` : ''}</div><span class="add">+</span></div>`;
}

// ── окно
export function openLibrary(app, view = 'items') {
  const w = $('#libWin');
  app.libView = view;
  w.style.display = 'flex';
  renderLibWin(app);
  setTimeout(() => $('#libQ')?.focus(), 0);
}
export function closeLibrary() { const w = $('#libWin'); if (w) w.style.display = 'none'; }
export const libraryOpen = () => $('#libWin')?.style.display === 'flex';

function renderLibWin(app) {
  const f = (app.libF ||= { q: '', cat: [], style: [], sil: [], mat: [], level: [], tags: [] });
  const fc = facets(), v = app.libView || 'items';
  const chip = (key, val, n, label) => `<button class="fc ${f[key].includes(val) ? 'on' : ''}" data-fk="${key}" data-fv="${esc(String(val))}">${esc(label ?? val)}<span class="n">${n}</span></button>`;
  $('#libBox').innerHTML = `<div class="lw-head"><h1>Библиотека лекал</h1>
    <div class="pill" id="lwTabs"><button data-v="items" class="${v === 'items' ? 'on' : ''}">Шаблоны</button><button data-v="outfits" class="${v === 'outfits' ? 'on' : ''}">Образы</button><button data-v="sources" class="${v === 'sources' ? 'on' : ''}">Источники</button></div>
    <input id="libQ" type="search" placeholder="Поиск: клёш, кожа, Rick, шнуровка, молния…" value="${esc(f.q)}">
    <button class="ghost" id="lwClose" title="Закрыть — Esc">×</button></div>
  <div class="lw-body"><aside class="lw-f">
    ${FACETS.map(([k, n]) => `<div class="facet"><span class="fh">${n}</span>${fc[k].map(([val, c]) => chip(k, val, c, k === 'style' ? dname(val) : k === 'level' ? LEVEL(+val) : null)).join('')}</div>`).join('')}
    <details class="facet"${f.tags.length ? ' open' : ''}><summary class="fh">Детали${f.tags.length ? ' · ' + f.tags.length : ''}</summary>${fc.tags.map(([val, c]) => chip('tags', val, c)).join('')}</details>
    <button class="sm ghost" id="libR" style="margin-top:8px">Сбросить фильтры</button>
    <p class="note" style="margin-top:12px">Конструкции строятся по меркам манекена. «Ассоциации» — приёмы кроя, узнаваемые у дизайнера, а не его оригинальные лекала.</p></aside>
  <section class="lw-main"><div class="muted" id="libN"></div><div id="libList"></div></section></div>`;
  const q = $('#libQ');
  q.oninput = () => { f.q = q.value; renderLibList(app); };
  $('#lwClose').onclick = closeLibrary;
  $('#lwTabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; app.libView = b.dataset.v; [...$('#lwTabs').children].forEach((x) => x.classList.toggle('on', x === b)); renderLibList(app); };
  $('#libBox').querySelectorAll('[data-fk]').forEach((b) => (b.onclick = () => {
    const k = b.dataset.fk, val = k === 'level' ? +b.dataset.fv : b.dataset.fv, arr = f[k], i = arr.indexOf(val);
    i >= 0 ? arr.splice(i, 1) : arr.push(val);
    b.classList.toggle('on', i < 0);
    if (k === 'tags') { const sm = b.closest('details')?.querySelector('summary'); if (sm) sm.textContent = 'Детали' + (f.tags.length ? ' · ' + f.tags.length : ''); }
    renderLibList(app);
  }));
  $('#libR').onclick = () => { app.libF = null; renderLibWin(app); };
  renderLibList(app);
}

function renderLibList(app) {
  const f = app.libF, el = $('#libList'), v = app.libView || 'items';
  if (!el) return;
  if (v === 'sources') {
    $('#libN').textContent = 'Открытые и бесплатные лекала вне КРОМКИ — для своей работы и как образцы приёмов';
    el.className = 'lw-src';
    el.innerHTML = OPEN_SOURCES.map((o) => `<div class="src"><b>${esc(o.n)}</b> <span class="chip">${esc(o.lic)}</span><div class="muted">${esc(o.what)}</div><div class="muted mono">${esc(o.url)}</div></div>`).join('');
    return;
  }
  if (v === 'outfits') {
    const os = outfitsFor(f.style);
    $('#libN').textContent = f.style.length ? `Образы по выбранным ассоциациям: ${os.length}` : `Образов: ${OUTFITS.length} — вещи и обувь собираются на манекене сразу, текущие изделия заменяются (вернуть — Ctrl+Z)`;
    el.className = 'lw-grid';
    el.innerHTML = (os.length ? os : OUTFITS).map((o) => `<div class="card big" data-outfit="${o.id}"><div style="flex:1;min-width:0"><div class="t">${esc(o.name)}</div>
      <div class="s">${o.items.map((id) => esc(findItem(id)?.name.split(/[,(]/)[0].toLowerCase() || id)).join(' + ')} + обувь</div><div class="as">${esc(o.style.map(dname).join(' · '))}</div></div><span class="add">Собрать</span></div>`).join('');
    el.querySelectorAll('[data-outfit]').forEach((c) => (c.onclick = () => { closeLibrary(); app.applyOutfit(c.dataset.outfit); }));
    return;
  }
  const items = searchLibrary(f.q, f);
  $('#libN').textContent = `${items.length} из ${LIBRARY.length}`;
  el.className = 'lw-grid';
  el.innerHTML = items.length ? items.map((p, i) => `${p.cat !== items[i - 1]?.cat ? `<div class="grp">${esc(p.cat)}</div>` : ''}${cardHTML(p, true)}`).join('')
    : '<p class="note">Ничего не нашлось — ослабьте фильтры.</p>';
  el.querySelectorAll('[data-add]').forEach((c) => (c.onclick = () => { closeLibrary(); app.addGarment(c.dataset.add); }));
}
