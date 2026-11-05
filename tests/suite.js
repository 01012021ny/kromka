// Regression suite: physics holds garments on the body, sleeves wrap arms, grading keeps seams matched,
// cutting preserves area, nesting places every piece, DXF has a block per piece.
import * as THREE from 'three';
import { Body, BODY_DEFAULT } from '../src/body.js';
import { GARMENT_PRESETS, GENERATORS, cutPiece, edgeLen, pieceArea, edgeK, seamLengths, edgePts, cutOutline, sewingSteps } from '../src/patterns.js';
import { Sim, seamRev } from '../src/sim.js';
import { makeMaterial } from '../src/materials.js';
import { gradeGarment, defaultGrading } from '../src/grading.js';
import { nestAll } from '../src/layout.js';
import { dxf, plt, zip, exportSets, shrinkScale } from '../src/export.js';
import { patternSpec, sampleShrink, compoundShrink } from '../src/spec.js';
import { garmentCost, stockFit } from '../src/cost.js';
import { addFacing, addBinding, addLining, removeLining } from '../src/finish.js';
import { makeAcc, buildAccessory, shoeShape } from '../src/accessories.js';
import { bbox, inside as inPoly, polyLen } from '../src/util.js';
import { LIBRARY, OUTFITS, DESIGNERS, findItem, searchLibrary, facets, applyDecor } from '../src/library.js';
import { addDecorZip, setSeamZip, zipEdges, zipPartner, hardwareAlong, zipList, pruneZipPulls, removeStroke } from '../src/hardware.js';

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
const holdY = { tee: 140, long: 140, tank: 140, tunic: 140, coat: 140, over: 140, trou: 96, dropc: 95, skirt: 95, snood: 128, jeans: 98, flare: 97, stack: 97, funnel: 150 };
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

console.log('Обтачка, бейка, подкладка');
{
  const { g, mat } = make('tee');
  const front = g.pieces.find((p) => p.name === 'Перед'), neck = front.corners.find((c) => front.meta[c.id].name === 'горловина').id;
  const L = edgeLen(front, edgeK(front, neck)), n0 = g.seams.length;
  const f = addFacing(g, front, neck, 4);
  ok('обтачка горловины: внутренняя деталь со швом по краю', f.piece && f.piece.inner && g.seams.length === n0 + 1 && f.piece.base === front.base);
  const A = pieceArea(f.piece);
  ok('обтачка: площадь ≈ длина края × ширина', Math.abs(A - L * 4) / (L * 4) < 0.25, `${A.toFixed(0)} см² при ${(L * 4).toFixed(0)}`);
  ok('обтачка: повторно на сшитую сторону — отказ', !!addFacing(g, front, neck, 4).error);
  const back = g.pieces.find((p) => p.name === 'Спинка'), bneck = back.corners.find((c) => back.meta[c.id].name === 'горловина').id;
  const bl = edgeLen(back, edgeK(back, bneck));
  const b = addBinding(g, back, bneck, 1);
  const bb = bbox(b.piece.pts);
  ok('бейка: полоса 4× готовой ширины, по косой, край без припуска', Math.abs(bb.h - 4) < 0.01 && b.piece.grain === 45 && back.meta[bneck].sa === 0 && back.meta[bneck].bound === 1, `${bb.w.toFixed(1)} × ${bb.h.toFixed(1)} при крае ${bl.toFixed(1)}`);
  const xl = gradeGarment(g, body.m, 'XL');
  const fX = xl.find((p) => p.id === front.id), ffX = xl.find((p) => p.id === f.piece.id);
  ok('градация: обтачка идёт за горловиной', Math.abs(edgeLen(ffX, edgeK(ffX, ffX.corners[0].id)) - edgeLen(fX, edgeK(fX, neck))) < 0.4, `${edgeLen(ffX, 0).toFixed(1)} / ${edgeLen(fX, edgeK(fX, neck)).toFixed(1)}`);
  const sim = drape([g], { [mat.id]: mat }, 60);
  ok('обтачка и бейка не драпируются в 3D', sim.pieces.length === g.pieces.filter((p) => !p.inner).length);
  const c = make('coat').g, outer = c.pieces.filter((p) => !p.inner).length, s0 = c.seams.length;
  const lin = makeMaterial('lining');
  const r = addLining(c, lin.id);
  ok('подкладка: копия каждой основной детали и её швы', r.pieces.length === outer && c.seams.length === s0 * 2 && r.pieces.every((p) => p.inner && p.lining && p.mat === lin.id));
  const hem = r.pieces[0].corners.map((k) => r.pieces[0].meta[k.id]).find((m) => m.name === 'низ');
  ok('подкладка: низ на 2 см выше (меньше припуск)', !hem || hem.sa < 3, `${hem?.sa}`);
  ok('подкладка: второй раз — отказ, убрать — убирается', !!addLining(c, lin.id).error && removeLining(c) === outer && c.seams.length === s0);
  const steps = sewingSteps({ ...g, extraSteps: g.extraSteps });
  ok('порядок пошива: шаг «Обтачки и бейки» с пояснением', steps.some((st) => st.title === 'Обтачки и бейки' && st.note && st.seams.length === 2));
}

console.log('Узлы: стойка, воронка, манжеты');
{
  const mk = (id, extra) => {
    const pr = GARMENT_PRESETS.find((p) => p.id === id), params = { ...pr.p, ...extra }, mat = makeMaterial(pr.mat);
    const out = GENERATORS.top(body.m, params);
    const g = { id: id + 'c', name: pr.name, gen: 'top', params, pieces: out.pieces, seams: out.seams, layer: 1, grading: defaultGrading('M') };
    for (const p of g.pieces) { p.mat = mat.id; p.base = p.name; }
    for (const s of g.seams) s.rev = seamRev(g, s, body);
    return { g, mat, out };
  };
  for (const [id, extra, nm] of [['tee', { collar: 1, collarH: 4 }, 'Стойка'], ['funnel', {}, 'Воронка'], ['coat', { collar: 2, collarH: 12 }, 'Воронка']]) {
    const { g, mat } = mk(id, extra);
    const co = g.pieces.find((p) => p.name === nm), ci = g.pieces.find((p) => p.name === nm + ' (внутренняя)');
    const att = g.seams.filter((s) => s.name.startsWith(nm + ': к горловине'));
    const worst = Math.max(...g.seams.filter((s) => !s.name.includes('Втачивание')).map((s) => Math.abs(seamLengths(g, s).diff)));
    ok(`${id}: ${nm.toLowerCase()} — две части, притачана ко всей горловине, швы равны`, co && ci && ci.inner && att.length === 3 && worst < 0.3, `макс. Δ ${worst.toFixed(2)}`);
    const sim = drape([g], { [mat.id]: mat }, 360);
    let gap = 0; for (let c = 0; c < sim.sw.length; c += 2) { const a = 3 * sim.sw[c], b = 3 * sim.sw[c + 1]; gap = Math.max(gap, Math.hypot(sim.x[a] - sim.x[b], sim.x[a + 1] - sim.x[b + 1], sim.x[a + 2] - sim.x[b + 2])); }
    const r = sim.pieces.find((q) => q.piece.name === nm); let top = -1e9; for (let i = r.off; i < r.off + r.n; i++) top = Math.max(top, sim.x[3 * i + 1]);
    ok(`${id}: ${nm.toLowerCase()} в 3D сшита и стоит над горловиной`, gap < 2 && top > body.m.y.neckBase + 2, `зазор ${gap.toFixed(2)} см, верх ${top.toFixed(1)}`);
  }
  {
    const { g } = mk('tee', { collar: 1 }), { g: g2 } = mk('tee', { collar: 2 });
    const len = (gg, n) => {
      const p = gg.pieces.find((q) => q.name === n);
      const top = p.corners.reduce((a, c, k) => a + (p.meta[c.id].name === 'край воротника' ? edgeLen(p, k) : 0), 0);
      const bot = gg.seams.filter((s) => s.name.startsWith(n + ': к горловине')).reduce((a, s) => a + edgeLen(p, edgeK(p, s.a.p === p.id ? s.a.e : s.b.e)), 0);
      return [top, bot];
    };
    const [st, sb] = len(g, 'Стойка'), [ft, fb] = len(g2, 'Воронка');
    ok('стойка облегает (верх короче низа), воронка раскрывается (верх длиннее)', st < sb - 1 && ft > fb + 3, `стойка ${st.toFixed(1)}/${sb.toFixed(1)}, воронка ${ft.toFixed(1)}/${fb.toFixed(1)}`);
  }
  {
    const { g, mat } = mk('long', { cuffs: 1, cuffH: 6 });
    const cuffs = g.pieces.filter((p) => p.name.startsWith('Манжета'));
    const worst = Math.max(...g.seams.filter((s) => !s.name.includes('Втачивание')).map((s) => Math.abs(seamLengths(g, s).diff)));
    ok('манжеты: две, сложены по низу, притачаны к рукавам', cuffs.length === 2 && cuffs.every((c) => c.corners.some((k) => c.meta[k.id].fold)) && g.seams.filter((s) => s.name.startsWith('Манжета: притачать')).length === 2 && worst < 0.3);
    const sl = g.pieces.find((p) => p.name === 'Рукав левый'), c = cuffs[0];
    ok('манжеты: общая длина рукава не меняется', Math.abs((bbox(sl.pts).h + bbox(c.pts).h) - bbox(mk('long', {}).g.pieces.find((p) => p.name === 'Рукав левый').pts).h) < 0.5);
    const sim = drape([g], { [mat.id]: mat }, 240);
    let nan = 0; for (let i = 0; i < sim.N * 3; i++) if (!isFinite(sim.x[i])) nan++;
    ok('манжеты: 3D без NaN', nan === 0);
  }
}

console.log('Брюки поверх обуви');
{
  const shoeBody = new Body(new THREE.Scene()); shoeBody.build(BODY_DEFAULT);
  const m3 = { leather: new THREE.MeshStandardMaterial(), sole: new THREE.MeshStandardMaterial(), knit: new THREE.MeshStandardMaterial(), metal: () => new THREE.MeshStandardMaterial() };
  for (const style of ['high', 'low']) {
    const sh = makeAcc('shoes', 'x'); sh.p.style = style; sh.p.shaft = style === 'high' ? 16 : 0;
    shoeBody.extraCaps = [];
    buildAccessory(sh, shoeBody, m3, { belts: [] });
    const t0 = performance.now(); shoeBody.buildGrid(); const tg = performance.now() - t0;
    const vols = shoeBody.legs.map((l) => shoeShape(shoeBody, l, sh.p));
    for (const id of ['jeans', 'flare']) {
      const pr = GARMENT_PRESETS.find((p) => p.id === id), mat = makeMaterial(pr.mat), out = GENERATORS.pants(shoeBody.m, pr.p);
      const g = { id, name: id, gen: 'pants', params: pr.p, pieces: out.pieces, seams: out.seams, layer: 0 };
      for (const p of g.pieces) p.mat = mat.id;
      for (const sm of g.seams) sm.rev = seamRev(g, sm, shoeBody);
      const sim = new Sim(shoeBody); sim.build([g], { [mat.id]: mat }, 2.6);
      for (let f = 0; f < 360; f++) sim.step(1 / 60);
      let inside = 0, nan = 0, ymin = 1e9;
      for (let i = 0; i < sim.N; i++) { const x = sim.x[3 * i], y = sim.x[3 * i + 1], z = sim.x[3 * i + 2]; if (!isFinite(y)) nan++; ymin = Math.min(ymin, y); if (vols.some((v) => v.inside(x, y, z, 0.5))) inside++; }
      ok(`${id} + кеды (${style}): ткань не внутри обуви (глубже 5 мм) и садится на неё`, inside === 0 && nan === 0 && ymin < 16, `внутри ${inside}, низ ${ymin.toFixed(1)} см, сетка коллизии ${tg.toFixed(0)} мс`);
    }
  }
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

console.log('Библиотека лекал: карточки, поиск, образы');
{
  const makeLib = (it) => {
    const mat = makeMaterial(it.mat);
    const out = GENERATORS[it.gen](body.m, { ...it.p });
    const g = { id: it.id, name: it.name, gen: it.gen, preset: it.id, params: { ...it.p }, pieces: out.pieces, seams: out.seams, layer: it.layer, grading: defaultGrading('M') };
    for (const p of g.pieces) { p.mat = mat.id; p.base = p.name; }
    if (it.decor) applyDecor(g, it.decor);
    for (const sm of g.seams) sm.rev = seamRev(g, sm, body);
    return { g, mat };
  };
  let bad = [];
  for (const it of LIBRARY) {
    try {
      const { g } = makeLib(it);
      const broken = g.pieces.some((p) => p.pts.length < 3 || p.pts.some(([x, y]) => !isFinite(x) || !isFinite(y)) || pieceArea(p) <= 0);
      if (broken || !g.seams.length && it.gen !== 'snood') bad.push(it.id);
    } catch (e) { bad.push(it.id + ': ' + e.message); }
  }
  ok(`все ${LIBRARY.length} карточек строятся по меркам`, !bad.length, bad.join(', '));
  ok('у карточек есть фасеты и ассоциации — с известными дизайнерами', LIBRARY.every((it) => it.cat && it.level >= 1 && it.level <= 3 && (it.style || []).every((s) => DESIGNERS.some((d) => d.id === s))));
  ok('образы ссылаются на существующие карточки', OUTFITS.every((o) => o.items.every((id) => findItem(id))) && OUTFITS.length >= 6);
  const rick = searchLibrary('оуэнс');
  ok('поиск по кириллическому имени дизайнера', rick.length >= 5 && rick.every((it) => it.style.includes('rick')), `${rick.length} шт.`);
  const lf = searchLibrary('кожа клёш');
  ok('поиск по нескольким словам — все слова', lf.some((it) => it.id === 'L-lflare') && lf.every((it) => /кож/.test(it.mat === 'lamb06' ? 'кожа' : JSON.stringify(it))), lf.map((x) => x.id).join(','));
  const jf = searchLibrary('', { cat: ['Джинсы'], style: ['balmain', 'n9'] });
  ok('фасеты: внутри «или», между «и»', jf.length >= 2 && jf.every((it) => it.cat === 'Джинсы' && it.style.some((s) => s === 'balmain' || s === 'n9')), jf.map((x) => x.id).join(','));
  ok('чипы фасетов с количеством', facets().style.length >= 10 && facets().cat.every(([, n]) => n > 0));
  // детали карточек
  const { g: moto, mat: lam } = makeLib(findItem('L-moto'));
  const zs = moto.seams.filter((s) => s.zip);
  ok('косуха: разъёмная молния по бортам — шов-застёжка', zs.length === 1 && zs[0].closure && zs[0].zip.open && zs[0].rev != null, zs.map((s) => s.name).join());
  ok('косуха: декоративные молнии у манжет на обоих рукавах', moto.pieces.filter((p) => p.place.kind === 'arm' && p.strokes.some((s) => s.mode === 'zip')).length === 2);
  const zl = zipList(moto);
  ok('молнии в списке: 1 рабочая + 2 декоративные', zl.length === 3 && zl.some((z) => z.open && z.len > 30), zl.map((z) => Math.round(z.len)).join('/'));
  const mc = garmentCost(moto, { [lam.id]: lam });
  const zt = mc.trims.find((t) => t.type === 'zipper');
  ok('себестоимость: молнии считаются целиком, бегунки — нет', zt && zt.n === 3 && /разъёмная/.test(zt.note) && mc.work.some((w) => /Молнии/.test(w.name)), zt ? `${zt.n} шт. · ${zt.note}` : '');
  ok('шаг пошива «Молнии»', sewingSteps(moto).some((st) => st.title === 'Молнии' && st.seams.some((x) => x.zip)));
  {
    const sim = drape([moto], { [lam.id]: lam }, 360);
    let ymax = -1e9; for (let i = 0; i < sim.N; i++) ymax = Math.max(ymax, sim.x[3 * i + 1]);
    const L = moto.pieces.find((p) => p.name === 'Полочка левая'), R = moto.pieces.find((p) => p.name === 'Полочка правая');
    const rl = sim.pieces.find((r) => r.piece === L), rr = sim.pieces.find((r) => r.piece === R);
    // середина бортов после посадки: молния застёгнута — борта рядом
    const mid = (rec, p) => { const e = edgePts(p, edgeK(p, p.corners.find((c) => p.meta[c.id].name === 'борт').id)); const q = e[Math.floor(e.length / 2)]; let bi = 0, bd = 1e9; rec.mesh.v2.forEach((v, i) => { const d = (v[0] - q[0]) ** 2 + (v[1] - q[1]) ** 2; if (d < bd) { bd = d; bi = i; } }); const k = (rec.off + bi) * 3; return [sim.x[k], sim.x[k + 1], sim.x[k + 2]]; };
    const a = rl && mid(rl, L), b = rr && mid(rr, R), gap = a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : 99;
    ok('косуха в 3D: держится на плечах, молния застёгнута', ymax > 140 && gap < 1.5, `верх ${ymax.toFixed(0)}, борта ${gap.toFixed(2)} см`);
  }
  const { g: vest } = makeLib(findItem('L-vest'));
  const eye = vest.pieces.flatMap((p) => p.hardware.filter((h) => h.type === 'eyelet').map((h) => ({ h, p })));
  ok('жилет: люверсы рядами по бокам переда и спинки, внутри деталей', eye.length >= 16 && eye.every(({ h, p }) => inPoly([h.x, h.y], p.pts)), `${eye.length} шт.`);
  const { g: moh } = makeLib(findItem('L-mohair'));
  ok('мохер: сырые края низа и рукавов', moh.pieces.filter((p) => p.corners.some((c) => p.meta[c.id].raw)).length >= 4);
  const { g: cargo } = makeLib(findItem('L-cargo'));
  ok('карго: накладные карманы на обеих передних половинках', cargo.pieces.filter((p) => p.overlays.length).length === 2);
  for (const id of ['L-harem', 'L-lflare']) {
    const { g, mat } = makeLib(findItem(id));
    const sim = drape([g], { [mat.id]: mat });
    let ymax = -1e9, nan = 0; for (let i = 0; i < sim.N; i++) { const y = sim.x[3 * i + 1]; if (!isFinite(y)) nan++; ymax = Math.max(ymax, y); }
    ok(`${id}: держится на талии`, ymax > 92 && !nan, `верх ${ymax.toFixed(0)}`);
  }
}

console.log('Молнии и фурнитура рядами');
{
  const { g, mat } = make('skirt');
  const f = g.pieces[0], side = f.corners.find((c) => f.meta[c.id].name === 'бок').id;
  const n = hardwareAlong(f, side, { type: 'rivet', step: 4, inset: 1.5 });
  const L = edgeLen(f, edgeK(f, side));
  ok('ряд вдоль края: число по шагу, все внутри детали', n === Math.floor((L - 4) / 4 + 1e-6) + 1 && f.hardware.every((h) => inPoly([h.x, h.y], f.pts)), `${n} шт. на ${L.toFixed(1)} см`);
  const sm = g.seams[0];
  setSeamZip(g, sm, { kind: 'hidden' });
  ok('потайная молния в боковом шве: застёжка без бегунка', sm.closure && !g.pieces.some((p) => p.hardware.some((h) => h.zipOf)) && f.meta[sm.a.e]?.zip?.kind === 'hidden');
  setSeamZip(g, sm, null);
  ok('убрать молнию — шов снова обычный', !sm.closure && !sm.zip && !f.meta[sm.a.e]?.zip && !sewingSteps(g).some((st) => st.title === 'Молнии'));
  const z = addDecorZip(f, [[0, 60], [0, 75]], { kind: 'coil' });
  const pull = f.hardware.find((h) => h.zipOf === z.id);
  ok('декоративная молния: бегунок у верхнего конца', pull && pull.y > 72 && zipList(g).length === 1, pull ? pull.y.toFixed(1) : '');
  removeStroke(f, z);
  ok('удалить молнию — уходит и бегунок', !f.hardware.some((h) => h.zipOf) && !zipList(g).length);
  const t = make('coat').g, fl = t.pieces.find((p) => p.name === 'Полочка левая'), bort = fl.corners.find((c) => fl.meta[c.id].name === 'борт').id;
  const pr = zipPartner(t, fl, bort);
  ok('пара для молнии: борт правой полочки', pr && pr.p.name === 'Полочка правая');
  const zs = zipEdges(t, fl, bort, pr.p, pr.e, { kind: 'metal' });
  ok('молния между бортами — новый шов', t.seams.includes(zs) && zs.zip.made && !zs.error);
  setSeamZip(t, zs, null);
  ok('убрать такую молнию — шов исчезает целиком', !t.seams.includes(zs) && !t.pieces.some((p) => p.hardware.some((h) => h.zipOf)));
  addDecorZip(fl, [[10, 70], [10, 90]]);
  fl.strokes = [];
  ok('бегунок без молнии подчищается', pruneZipPulls(t).length === 1 && !fl.hardware.some((h) => h.zipOf));
  void mat;
}

console.log(`\n${pass} пройдено, ${fail} провалено`);
if (fail) process.exit(1);
