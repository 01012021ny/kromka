// Regression suite: physics holds garments on the body, sleeves wrap arms, grading keeps seams matched,
// cutting preserves area, nesting places every piece, DXF has a block per piece.
import * as THREE from 'three';
import { Body, BODY_DEFAULT } from '../src/body.js';
import { GARMENT_PRESETS, GENERATORS, cutPiece, edgeLen, pieceArea, edgeK, seamLengths, edgePts, cutOutline } from '../src/patterns.js';
import { Sim, seamRev } from '../src/sim.js';
import { makeMaterial } from '../src/materials.js';
import { gradeGarment, defaultGrading } from '../src/grading.js';
import { nestAll } from '../src/layout.js';
import { dxf, plt, zip, exportSets, shrinkScale } from '../src/export.js';
import { patternSpec, sampleShrink, compoundShrink } from '../src/spec.js';
import { garmentCost, stockFit } from '../src/cost.js';
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
const holdY = { tee: 140, long: 140, tank: 140, tunic: 140, coat: 140, over: 140, trou: 96, dropc: 95, skirt: 95, snood: 128, jeans: 98, flare: 97, stack: 97 };
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

console.log('Джинсы и силуэты брюк');
{
  const pants = GARMENT_PRESETS.filter((p) => p.gen === 'pants');
  for (const pr of pants) {
    const { g } = make(pr.id);
    const worst = Math.max(...g.seams.filter((s) => !s.closure && !s.ease).map((s) => Math.abs(seamLengths(g, s).diff)));
    ok(`${pr.id}: сшиваемые стороны равны по длине`, worst < 0.3, `макс. Δ ${worst.toFixed(2)} см`);
  }
  const { g, mat } = make('jeans');
  const names = g.pieces.map((p) => p.name).join('|');
  ok('джинсы: кокетка, бочок, пояс, мешковина, гульфик', ['Кокетка (лев.)', 'Бочок (прав.)', 'Пояс', 'Мешковина передняя (лев.)', 'Откосок', 'Гульфик', 'Шлёвки'].every((n) => names.includes(n)));
  ok('джинсы: накладки — 2 задних и часовой карман', g.pieces.reduce((a, p) => a + p.overlays.length, 0) === 3);
  const sim = drape([g], { [mat.id]: mat }, 360);
  ok('джинсы: внутренние детали не драпируются', sim.pieces.length === g.pieces.filter((p) => !p.inner).length && sim.pieces.length === 9, `${sim.pieces.length} в 3D`);
  const band = sim.pieces.find((r) => r.piece.place.kind === 'band');
  let by = 0; for (let i = band.off; i < band.off + band.n; i++) by += sim.x[3 * i + 1]; by /= band.n;
  ok('джинсы: пояс держится выше бёдер', by > body.m.y.hip + 6, `${by.toFixed(1)} при бёдрах ${body.m.y.hip.toFixed(1)}`);
  let gap = 0; for (let c = 0; c < sim.sw.length; c += 2) { const a = 3 * sim.sw[c], b = 3 * sim.sw[c + 1]; gap = Math.max(gap, Math.hypot(sim.x[a] - sim.x[b], sim.x[a + 1] - sim.x[b + 1], sim.x[a + 2] - sim.x[b + 2])); }
  ok('джинсы: швы в 3D сомкнуты', gap < 0.6, `макс. зазор ${gap.toFixed(2)} см`);
  // клёш: низ шире колена, подгибка перпендикулярна боковому шву, сзади длиннее
  const fl = make('flare').g, P = GARMENT_PRESETS.find((p) => p.id === 'flare').p;
  const front = fl.pieces.find((p) => p.name === 'Передняя половинка (лев.)'), back = fl.pieces.find((p) => p.name === 'Задняя половинка (лев.)');
  const kneeW = (pc) => { const y = body.m.y.knee + P.kneeY, xs = []; const pts = pc.pts; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1])); } return Math.max(...xs) - Math.min(...xs); };
  const hemOf = (pc) => edgePts(pc, pc.corners.findIndex((c) => pc.meta[c.id].name === 'низ'));
  const hf = hemOf(front), hb = hemOf(back);
  const hemW = (h) => Math.abs(h[h.length - 1][0] - h[0][0]);
  ok('клёш: низ шире колена', hemW(hf) > kneeW(front) + 8, `${hemW(hf).toFixed(1)} > ${kneeW(front).toFixed(1)}`);
  const sideK = front.corners.findIndex((c) => front.meta[c.id].name === 'бок'), side = edgePts(front, sideK);
  const hemEnd = hf[hf.length - 1][0] > hf[0][0] ? [hf[hf.length - 2], hf[hf.length - 1]] : [hf[1], hf[0]];
  const sideStart = side[0][1] < side[side.length - 1][1] ? [side[0], side[3]] : [side[side.length - 1], side[side.length - 4]];
  const v1 = [hemEnd[0][0] - hemEnd[1][0], hemEnd[0][1] - hemEnd[1][1]], v2 = [sideStart[1][0] - sideStart[0][0], sideStart[1][1] - sideStart[0][1]];
  const ang = (Math.acos((v1[0] * v2[0] + v1[1] * v2[1]) / Math.hypot(...v1) / Math.hypot(...v2)) * 180) / Math.PI;
  ok('клёш: угол низа и бокового шва ≈ 90°', Math.abs(ang - 90) < 12, `${ang.toFixed(0)}°`);
  const minY = (h) => Math.min(...h.map((q) => q[1]));
  ok('клёш: сзади низ длиннее переда (под каблук)', minY(hf) - minY(hb) > P.hemBack, `${(minY(hf) - minY(hb)).toFixed(1)} см`);
  // табель мер джинсов: пояс считается по сгибу пояса, бок — вместе с поясом
  const rows = Object.fromEntries(patternSpec(g, body.m).map((r) => [r.key, r.val]));
  const bandP = g.pieces.find((p) => p.name === 'Пояс');
  ok('джинсы: обхват пояса = верх пояса', Math.abs(rows.waist * 2 - edgeLen(bandP, bandP.corners.findIndex((c) => bandP.meta[c.id].fold))) < 0.3, `${rows.waist} см`);
  ok('джинсы: длина по боку включает пояс', rows.outseam > rows.inseam + 20 && rows.outseam < 112, `${rows.outseam} см`);
  // экспорт: накладки — отдельные детали, верх кармана с припуском на подгибку
  const app = { body, S: { garments: [g] }, matsById: () => ({ [mat.id]: mat }) };
  const set = exportSets(app, { garments: [g.id], sizes: ['M'] })[0];
  const pk = set.pieces.find((p) => p.name.startsWith('Задний карман'));
  ok('экспорт: накладки идут отдельными деталями', set.pieces.length === g.pieces.length + 3 && !!pk);
  const pkH = bbox(pk.pts).h, cutH = bbox(cutOutline(pk)).h;
  ok('экспорт: верх кармана с подгибкой 3 см', Math.abs(cutH - pkH - 4) < 0.3, `${pkH.toFixed(1)} → ${cutH.toFixed(1)}`);
  const r = nestAll([g], { [mat.id]: mat }, { shrink: false, rotate: true, gap: 0.3 })[0];
  ok('раскладка джинсов: всё на рулоне', !r.placed.some((p) => p.fail), `${r.placed.length} деталей, ${(r.util * 100).toFixed(0)}%`);
  // градация джинсов
  const xl = gradeGarment(g, body.m, 'XL');
  const gw = Math.max(...g.seams.filter((s) => !s.closure).map((s) => Math.abs(seamLengths({ pieces: xl }, s).diff)));
  ok('градация джинсов: швы XL сходятся', gw < 0.4, `${gw.toFixed(2)} см`);
}

console.log('Сгиб у колена, болт-фронт, себестоимость');
{
  const makeP = (id, extra) => {
    const pr = GARMENT_PRESETS.find((p) => p.id === id), params = { ...pr.p, ...extra }, mat = makeMaterial(pr.mat);
    const out = GENERATORS.pants(body.m, params);
    const g = { id: id + 'x', name: pr.name, gen: 'pants', params, pieces: out.pieces, seams: out.seams, layer: 0, trims: out.trims, grading: defaultGrading('M') };
    for (const p of g.pieces) { p.mat = mat.id; p.base = p.name; }
    for (const s of g.seams) s.rev = seamRev(g, s, body);
    return { g, mat };
  };
  for (const id of ['trou', 'jeans']) {
    const { g, mat } = makeP(id, { artKnee: 2.5 });
    const low = g.pieces.filter((p) => p.name.startsWith('Перед ниже колена'));
    const knee = g.seams.filter((s) => s.ease);
    ok(`${id}: сгиб у колена — нижняя часть переда и шов с посадкой`, low.length === 2 && knee.length === 2);
    const kd = knee.map((s) => -seamLengths(g, s).diff);
    ok(`${id}: посадка у колена 0,3–2 см`, kd.every((d) => d > 0.3 && d < 2), kd.map((d) => d.toFixed(2)).join(' / '));
    const worst = Math.max(...g.seams.filter((s) => !s.ease && !s.closure).map((s) => Math.abs(seamLengths(g, s).diff)));
    ok(`${id}: остальные швы со сгибом сходятся`, worst < 0.3, `${worst.toFixed(2)} см`);
    const sim = drape([g], { [mat.id]: mat }, 300);
    let nan = 0, ymax = -1e9; for (let i = 0; i < sim.N; i++) { const y = sim.x[3 * i + 1]; if (!isFinite(y)) nan++; ymax = Math.max(ymax, y); }
    ok(`${id}: со сгибом у колена держится, без NaN`, nan === 0 && ymax > 97, `верх ${ymax.toFixed(0)}`);
  }
  {
    const { g, mat } = makeP('flare', {});
    const band = g.pieces.find((p) => p.name === 'Пояс');
    const len = (nm) => band.corners.reduce((a, c, k) => a + (band.meta[c.id].name === nm ? edgeLen(band, k) : 0), 0);
    ok('контурный пояс: верх короче низа, обтачка отдельно', len('пояс') < len('шов пояса') - 2 && g.pieces.some((p) => p.name === 'Обтачка пояса' && p.inner), `${len('шов пояса').toFixed(1)} → ${len('пояс').toFixed(1)}`);
    const rows = Object.fromEntries(patternSpec(g, body.m).map((r) => [r.key, r.val]));
    ok('контурный пояс: в табеле мер высота пояса 4 см, а не габарит дуги', rows.outseam < 110, `${rows.outseam} см`);
    const sim = drape([g], { [mat.id]: mat }, 300);
    const r = sim.pieces.find((q) => q.piece.place.kind === 'band');
    let by = 0; for (let i = r.off; i < r.off + r.n; i++) by += sim.x[3 * i + 1]; by /= r.n;
    ok('контурный пояс: в 3D держится выше бёдер', by > body.m.y.hip + 6, `${by.toFixed(1)}`);
  }
  const zip = makeP('jeans', {}).g, bf = makeP('jeans', { buttonFly: 1 }).g;
  ok('джинсы: молния в фурнитуре, болт-фронт — пуговицы', zip.trims[0].type === 'zipper' && bf.trims[0].type === 'button' && bf.trims[0].n >= 3 && bf.pieces.some((p) => p.name.startsWith('Откосок с петлями')));
  const { g, mat } = makeP('jeans', {});
  mat.price = 1000;
  const c = garmentCost(g, { [mat.id]: mat }, { rate: 600 });
  const rivets = c.trims.find((t) => t.type === 'rivet')?.n || 0;
  ok('себестоимость: ткань, фурнитура, нитки, работа', c.fabricRub > 500 && rivets >= 6 && c.trims.some((t) => t.type === 'zipper') && c.minutes > 60 && c.minutes < 400 && Math.abs(c.total - (c.fabricRub + c.trimsRub + c.threadRub + c.laborRub)) < 1e-6, `${Math.round(c.total)} ₽ · ${(c.minutes / 60).toFixed(1)} ч · ткань ${c.fabric[0].qty.toFixed(2)} м`);
  const fit = stockFit({ mat: { stock: 1.2 }, length: 150, placed: [] }), fit2 = stockFit({ mat: { stock: 2 }, length: 150, placed: [] });
  ok('отрез: хватит / не хватит', !fit.ok && Math.abs(fit.left + 0.3) < 1e-9 && fit2.ok && stockFit({ mat: {}, length: 150, placed: [] }) === null);
}

console.log('Образец: усадка и калибровка');
{
  const sh = sampleShrink([{ axis: 'l', val: 100, sample: 97 }, { axis: 'l', val: 50, sample: 48.5 }, { axis: 'w', val: 40, sample: 39.2 }]);
  ok('усадка по замерам образца', Math.abs(sh.l - 3) < 0.05 && Math.abs(sh.w - 2) < 0.05 && sh.n === 3, `Д ${sh.l?.toFixed(2)}% · Ш ${sh.w?.toFixed(2)}%`);
  ok('усадка складывается как множители', Math.abs(compoundShrink(3, 2) - (100 - 97 * 0.98)) < 0.06, `3% + 2% → ${compoundShrink(3, 2)}%`);
  const sq = { pts: [[0, 0], [10, 0], [10, 10], [0, 10]], overlays: [], grain: 0 };
  const sc = shrinkScale(sq, { shrink: [5, 2] });
  ok('лекало с припуском на усадку', Math.abs(bbox(sc.pts).h - 10 / 0.95) < 1e-6 && Math.abs(bbox(sc.pts).w - 10 / 0.98) < 1e-6, `${bbox(sc.pts).w.toFixed(3)} × ${bbox(sc.pts).h.toFixed(3)}`);
  const sc90 = shrinkScale({ ...sq, grain: 90 }, { shrink: [5, 2] });
  ok('усадка следует за долевой нитью детали', Math.abs(bbox(sc90.pts).w - 10 / 0.95) < 1e-6, `${bbox(sc90.pts).w.toFixed(3)}`);
  ok('обхват манекена по высоте', Math.abs(body.girthAt(body.m.y.waist) - body.m.waist) < 2.5 && body.girthAt(body.m.y.hip) > body.girthAt(body.m.y.waist), `${body.girthAt(body.m.y.waist).toFixed(1)} / ${body.m.waist.toFixed(1)}`);
}

console.log(`\n${pass} пройдено, ${fail} провалено`);
if (fail) process.exit(1);
