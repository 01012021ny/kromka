// DOM helpers and slider+number controls shared by the panels
import { fmt } from '../util.js';

export const $ = (s) => document.querySelector(s);

export function ctl(id, label, v, min, max, step, unit = '') {
  if (min === 0 && max === 1 && step === 1) return `<div class="row"><label style="flex:1">${label.replace(/\s*\(0\/1\)/, '')}</label><input type="checkbox" id="${id}" ${+v ? 'checked' : ''}></div>`;
  return `<div class="ctl"><label>${label}<b id="${id}_v">${fmt(v, step < 1 ? 1 : 0)}${unit}</b></label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}"><input type="number" id="${id}_n" min="${min}" max="${max}" step="${step}" value="${+(+v).toFixed(2)}"></div>`;
}
export function bindCtl(id, fn, unit = '', dec = 1) {
  const r = document.getElementById(id), n = document.getElementById(id + '_n'), v = document.getElementById(id + '_v');
  if (!r) return;
  if (r.type === 'checkbox') { r.onchange = () => fn(r.checked ? 1 : 0, true); return; }
  const upd = (val, fin) => { r.value = val; n.value = val; v.textContent = fmt(+val, dec) + unit; fn(+val, fin); };
  r.oninput = () => upd(r.value, false); r.onchange = () => upd(r.value, true);
  n.onchange = () => upd(n.value, true);
}
