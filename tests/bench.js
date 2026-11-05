// Замер скорости ключевых операций (ориентир для слабых ноутбуков: i7-10510U + Intel UHD).
// Запуск: npm run bench. Не тест — печатает время; бюджеты — в CLAUDE.md.
import * as THREE from 'three';
import { Body, BODY_DEFAULT } from '../src/body.js';
import { GARMENT_PRESETS, GENERATORS } from '../src/patterns.js';
import { Sim, seamRev } from '../src/sim.js';
import { makeMaterial } from '../src/materials.js';
import { nestAll } from '../src/layout.js';
import { gradeGarment, defaultGrading } from '../src/grading.js';
import { garmentCost } from '../src/cost.js';

const body = new Body(new THREE.Scene()); body.build(BODY_DEFAULT);
const t = (fn, n = 1) => { const t0 = performance.now(); let r; for (let i = 0; i < n; i++) r = fn(); return [(performance.now() - t0) / n, r]; };
const mats = {};
const make = (id) => {
  const pr = GARMENT_PRESETS.find((p) => p.id === id), mat = makeMaterial(pr.mat);
  mats[mat.id] = mat;
  const out = GENERATORS[pr.gen](body.m, pr.p);
  const g = { id, name: pr.name, gen: pr.gen, params: pr.p, pieces: out.pieces, seams: out.seams, layer: pr.layer, trims: out.trims, grading: defaultGrading('M'), visible: true };
  for (const p of g.pieces) { p.mat = mat.id; p.base = p.name; }
  for (const s of g.seams) s.rev = seamRev(g, s, body);
  return g;
};
const row = (name, ms, extra = '') => console.log(`${name.padEnd(46)} ${ms.toFixed(1).padStart(8)} мс  ${extra}`);
const [tg] = t(() => GENERATORS.pants(body.m, GARMENT_PRESETS.find((p) => p.id === 'jeans').p), 5);
row('лекала джинсов (генерация)', tg);
const jeans = make('jeans'), top = make('long');
for (const q of [2.6, 1.8]) {
  const sim = new Sim(body);
  const [tb] = t(() => sim.build([jeans, top], mats, q));
  for (let f = 0; f < 30; f++) sim.step(1 / 60);
  const [ts] = t(() => sim.step(1 / 60), 90);
  row(`физика: сборка (джинсы + лонгслив, сетка ${q})`, tb, `${sim.N} точек`);
  row(`физика: шаг (джинсы + лонгслив, сетка ${q})`, ts, `${(1000 / ts).toFixed(0)} шаг/с`);
}
const [tl, lay] = t(() => nestAll([jeans, top], mats, { shrink: true, rotate: true, gap: 0.3 }));
row('раскладка: джинсы + лонгслив, 1 комплект', tl, lay.map((r) => `${r.placed.length} дет.`).join(', '));
const expand = (g) => ['S', 'M', 'L'].map((sz) => ({ size: sz, qty: 1, pieces: sz === 'M' ? g.pieces : gradeGarment(g, body.m, sz) }));
const [tl3] = t(() => nestAll([jeans, top], mats, { shrink: true, rotate: true, gap: 0.3 }, expand));
row('раскладка: тираж S+M+L', tl3);
const [tgr] = t(() => gradeGarment(jeans, body.m, 'XL'), 3);
row('градация джинсов в XL', tgr);
const [tc] = t(() => garmentCost(jeans, mats));
row('себестоимость джинсов (с раскладкой)', tc);
