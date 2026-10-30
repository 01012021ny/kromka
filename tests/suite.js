// Regression suite: physics holds garments on the body, sleeves wrap arms, grading keeps seams matched,
// cutting preserves area, nesting places every piece, DXF has a block per piece.
import * as THREE from 'three';
import { Body, BODY_DEFAULT } from '../src/body.js';
import { GARMENT_PRESETS, GENERATORS, cutPiece, edgeLen, pieceArea, edgeK } from '../src/patterns.js';
import { Sim, seamRev } from '../src/sim.js';
import { makeMaterial } from '../src/materials.js';
import { gradeGarment, defaultGrading } from '../src/grading.js';
import { nestAll } from '../src/layout.js';
import { dxf, plt, zip } from '../src/export.js';
import { bbox } from '../src/util.js';

let pass = 0, fail = 0;
const ok = (name, cond, info = '') => { if (cond) { pass++; console.log('  ✓', name, info); } else { fail++; console.log('  ✗', name, info); } };
const body = new Body(new THREE.Scene()); body.build(BODY_DEFAULT);
const make = (id) => {
  const pr = GARMENT_PRESETS.find((p) => p.id === id);
  const mat = makeMaterial(pr.mat);
  const out = GENERATORS[pr.gen](body.m, pr.p);
  const g = { id, name: pr.name, gen: pr.gen, params: pr.p, pieces: out.pieces, seams: out.seams, layer: pr.layer, grading: defaultGrading('M') };
  for (const p of g.pieces) { p.mat = mat.id; p.base = p.name; }
  for (const s of g.seams) s.rev = seamRev(g, s, body);
  return { g, mat };
};
const drape = (gs, mats, steps = 300) => { const sim = new Sim(body); sim.build(gs, mats, 2.6); for (let f = 0; f < steps; f++) sim.step(1 / 60); return sim; };

console.log('Физика: изделие держится на теле');
const holdY = { tee: 140, long: 140, tank: 140, tunic: 140, coat: 140, over: 140, trou: 96, dropc: 95, skirt: 95, snood: 128 };
for (const id of Object.keys(holdY)) {
  const { g, mat } = make(id);
  const sim = drape([g], { [mat.id]: mat });
  let ymax = -1e9, inside = 0, nan = 0;
  const o = [0, 0, 0];
  for (let i = 0; i < sim.N; i++) { const y = sim.x[3 * i + 1]; if (!isFinite(y)) nan++; ymax = Math.max(ymax, y); if (body.sdf(sim.x[3 * i], y, sim.x[3 * i + 2], o) < -0.5) inside++; }
  ok(`${id}: держится (верх ${ymax.toFixed(0)} ≥ ${holdY[id]})`, ymax >= holdY[id] && nan === 0);
  ok(`${id}: ткань не внутри тела`, inside <= Math.max(2, sim.N * 0.003), `${inside}/${sim.N}`);
}

console.log('Физика: рукав обхватывает руку');
{
  const { g, mat } = make('long');
  const sim = drape([g], { [mat.id]: mat }, 360);
  for (const r of sim.pieces.filter((r) => r.piece.place.kind === 'arm')) {
    const a = body.arms[r.piece.place.limb === 'L' ? 0 : 1];
    const bins = new Array(12).fill(0);
    for (let i = r.off; i < r.off + r.n; i++) {
      const p = new THREE.Vector3(sim.x[3 * i], sim.x[3 * i + 1], sim.x[3 * i + 2]).sub(a.J);
      const s = p.dot(a.d); if (s < 20 || s > 55) continue;
      const perp = p.addScaledVector(a.d, -s);
      bins[Math.floor(((Math.atan2(perp.z, perp.dot(a.o)) + Math.PI) / (2 * Math.PI)) * 12) % 12]++;
    }
    ok(`${r.piece.name}: охват 360°`, bins.every((b) => b > 0), bins.join(','));
  }
}

console.log('Лекала: разрез сохраняет площадь и добавляет шов');
{
  const { g } = make('tee');
  const f = g.pieces[0], A0 = pieceArea(f), b = bbox(f.pts), n0 = g.seams.length;
  const r = cutPiece(g, f, [[b.x0 - 5, b.y0 + 30], [b.x1 + 5, b.y0 + 42]]);
  ok('разрез без ошибки', !r.error);
  ok('площадь сохранена', Math.abs(pieceArea(r.A) + pieceArea(r.B) - A0) < 0.5, `${A0.toFixed(1)} → ${(pieceArea(r.A) + pieceArea(r.B)).toFixed(1)}`);
  ok('добавлены швы (членение + деление боковых)', g.seams.length >= n0 + 1, `${n0} → ${g.seams.length}`);
  let worst = 0;
  for (const s of g.seams) { const pa = g.pieces.find((p) => p.id === s.a.p), pb = g.pieces.find((p) => p.id === s.b.p); worst = Math.max(worst, Math.abs(edgeLen(pa, edgeK(pa, s.a.e)) - edgeLen(pb, edgeK(pb, s.b.e)))); }
  ok('длины сшиваемых сторон совпадают после разреза', worst < 2.0, `макс. Δ ${worst.toFixed(2)} см (окат с посадкой)`);
  // grading of the cut garment
  const xl = gradeGarment(g, body.m, 'XL'), xs = gradeGarment(g, body.m, 'XS');
  const w = (ps) => bbox(ps.find((p) => p.id === f.id).pts).w;
  ok('градация: XS < M < XL', w(xs) < w(g.pieces) && w(g.pieces) < w(xl), `${w(xs).toFixed(1)} / ${w(g.pieces).toFixed(1)} / ${w(xl).toFixed(1)}`);
  let gw = 0;
  for (const s of g.seams) { const pa = xl.find((p) => p.id === s.a.p), pb = xl.find((p) => p.id === s.b.p); const pa0 = g.pieces.find((p) => p.id === s.a.p), pb0 = g.pieces.find((p) => p.id === s.b.p); const d = Math.abs(edgeLen(pa, edgeK(pa, s.a.e)) - edgeLen(pb, edgeK(pb, s.b.e))), d0 = Math.abs(edgeLen(pa0, edgeK(pa0, s.a.e)) - edgeLen(pb0, edgeK(pb0, s.b.e))); gw = Math.max(gw, d - d0); }
  ok('градация не разводит швы', gw < 0.4, `${gw.toFixed(2)} см`);
}

console.log('Раскладка');
for (const id of ['tee', 'trou', 'coat']) {
  const { g, mat } = make(id);
  const r = nestAll([g], { [mat.id]: mat }, { shrink: true, rotate: true, gap: 0.3 })[0];
  ok(`${id}: все детали на рулоне, использование ${(r.util * 100).toFixed(0)}%`, !r.placed.some((p) => p.fail) && r.util > 0.35);
  // no mirroring: transformed polygon keeps orientation sign
  const pl = r.placed[0], m = pl.m;
  ok(`${id}: детали не зеркалятся на ткани`, m[0] * m[3] - m[1] * m[2] > 0);
}

console.log('Экспорт');
{
  const { g, mat } = make('tee');
  const app = { matsById: () => ({ [mat.id]: mat }) };
  const sets = [{ g, size: 'M', pieces: g.pieces }, { g, size: 'XL', pieces: gradeGarment(g, body.m, 'XL') }];
  const d = dxf(app, sets);
  ok('DXF: блок на каждую деталь', (d.match(/\r\nBLOCK\r\n/g) || []).length === sets.reduce((a, s) => a + s.pieces.length, 0));
  ok('DXF: завершён EOF', d.trim().endsWith('EOF'));
  const p = plt(app, sets);
  ok('PLT: начинается с IN', p.startsWith('IN;'));
  const z = zip([{ name: 'a.txt', data: 'hello' }]);
  ok('ZIP собран', z.size > 22);
}

console.log(`\n${pass} пройдено, ${fail} провалено`);
if (fail) process.exit(1);
