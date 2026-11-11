// Regression suite: physics holds garments on the body, sleeves wrap arms, grading keeps seams matched,
// cutting preserves area, nesting places every piece, DXF has a block per piece.
import * as THREE from 'three';
import { Body, BODY_DEFAULT, measure } from '../src/body.js';
import { GARMENT_PRESETS, GENERATORS, adaptParams, fitSnap, cutPiece, edgeLen, pieceArea, edgeK, seamLengths, edgePts, cutOutline, sewingSteps } from '../src/patterns.js';
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
import { importPatternFile, parseSVG, edgesFromOutline } from '../src/importer.js';
import zlib from 'zlib';
import { readFileSync } from 'fs';
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

console.log('Размер и посадка: манекен, якоря посадки, слои');
{
  // SDF ноги совпадает с видимой ногой (раньше плавное объединение соседних капсул раздувало ногу на ~1,4 см)
  const o = [0, 0, 0], legs = [];
  body.group.traverse((m) => { if (m.isMesh && m.geometry.type === 'BufferGeometry') legs.push(m); });
  const v = new THREE.Vector3(); let sum = 0, n = 0;
  for (const m of legs) { m.updateMatrixWorld(true); const pos = m.geometry.attributes.position; for (let k = 0; k < pos.count; k++) { v.fromBufferAttribute(pos, k).applyMatrix4(m.matrixWorld); if (v.y > body.m.y.crotch - 4 || v.y < body.m.y.ankle + 4 || Math.abs(v.x) < 4) continue; sum += body.sdf(v.x, v.y, v.z, o); n++; } }
  ok('коллизия ноги совпадает с видимой ногой (±3 мм)', n > 200 && Math.abs(sum / n) < 0.3, `средн ${(sum / n).toFixed(2)} см, ${n} точек`);
  // параметры карточек переносятся на другую фигуру с сохранением пропорций
  const ref = fitSnap(body.m), mb = new Body(null); mb.build({ ...BODY_DEFAULT, sex: 1, height: 186, weight: 80, bf: 15 }, { noGrid: true });
  const to = fitSnap(mb.m), jp = GARMENT_PRESETS.find((p) => p.id === 'jeans').p, lp = GARMENT_PRESETS.find((p) => p.id === 'long').p;
  const ja = adaptParams('pants', jp, ref, to), la = adaptParams('top', lp, ref, to);
  ok('на той же фигуре параметры не меняются', JSON.stringify(adaptParams('pants', jp, ref, fitSnap(body.m))) === JSON.stringify(jp));
  ok('на высокой мужской фигуре: длиннее брюки и рукава, шире колено на разницу обхватов', ja.len > jp.len + 3 && la.sleeve > lp.sleeve && Math.abs(ja.knee - jp.knee - (to.knee - ref.knee)) < 0.6 && ja.ease === jp.ease, `длина ${jp.len}→${ja.len}, колено ${jp.knee}→${ja.knee}, рукав ${lp.sleeve}→${la.sleeve}`);
  // drape с нормалями после шага — как в приложении (поток физики считает их каждый кадр)
  const drapeN = (gs, mats, steps, fit = true) => { const sim = new Sim(body); sim.holdFit = fit; sim.build(gs, mats, 2.6); for (let f = 0; f < steps; f++) { sim.step(1 / 60); sim.computeNormals(); } return sim; };
  const waistSlip = (sim) => { let s = 0, c = 0; for (const r of sim.pieces) { if (r.piece.place.kind !== 'leg' && r.piece.place.kind !== 'torso') continue; const v2 = r.mesh.v2; let ym = -1e9; for (let i = 0; i < r.n; i++) ym = Math.max(ym, v2[2 * i + 1]); for (let i = 0; i < r.n; i++) if (v2[2 * i + 1] > ym - 3) { s += sim.x[3 * (r.off + i) + 1] - v2[2 * i + 1]; c++; } } return s / c; };
  for (const id of ['jeans', 'skirt']) {
    const { g, mat } = make(id);
    const on = waistSlip(drapeN([g], { [mat.id]: mat }, 300)), off = waistSlip(drapeN([g], { [mat.id]: mat }, 300, false));
    ok(`${id}: пояс держится на задуманной высоте (без якорей сползал)`, on > -1.2 && off < on - 1.5, `с посадкой ${on.toFixed(1)} см, без ${off.toFixed(1)} см`);
  }
  // два верха с одинаковым слоем: у каждого свой ранг, внешний не прорастает сквозь внутренний
  const tangled = (sim, gIn, gOut) => {
    const ins = [], outs = [];
    for (const r of sim.pieces) for (let i = r.off; i < r.off + r.n; i++) (r.garment === gIn ? ins : r.garment === gOut ? outs : []).push(i);
    const x = sim.x, ow = sim.outward; let bad = 0;
    for (const i of outs) { let best = 1e9, bs = 0; for (const j of ins) { const dx = x[3 * i] - x[3 * j], dy = x[3 * i + 1] - x[3 * j + 1], dz = x[3 * i + 2] - x[3 * j + 2]; const sN = dx * ow[3 * j] + dy * ow[3 * j + 1] + dz * ow[3 * j + 2]; const lat = dx * dx + dy * dy + dz * dz - sN * sN; if (lat < 2.56 && Math.abs(sN) < 4 && lat < best) { best = lat; bs = sN; } } if (best < 1e9 && bs < -0.3) bad++; }
    return { bad, n: outs.length };
  };
  const A = make('tee'), B = make('long');
  A.g.layer = 1; B.g.layer = 1; B.mat.id = 'm-long';
  for (const p of B.g.pieces) p.mat = B.mat.id;
  const sim2 = drapeN([A.g, B.g], { [A.mat.id]: A.mat, [B.mat.id]: B.mat }, 300);
  const t1 = tangled(sim2, A.g, B.g);
  ok('два верха в одном слое: позже добавленный снаружи, не перепутаны', t1.bad < t1.n * 0.02 && sim2.pieces.find((r) => r.garment === B.g).layer > sim2.pieces.find((r) => r.garment === A.g).layer, `перепутано ${t1.bad} из ${t1.n}`);
  // захват пятном: резкий рывок внешней вещи внутрь не оставляет её под нижней после отпускания
  let gi = -1, bz = -1e9;
  for (const r of sim2.pieces) if (r.garment === B.g && r.piece.name === 'Перед') for (let i = r.off; i < r.off + r.n; i++) { const y = sim2.x[3 * i + 1]; if (Math.abs(y - 100) < 3 && sim2.x[3 * i + 2] > bz) { bz = sim2.x[3 * i + 2]; gi = i; } }
  const p0 = [sim2.x[3 * gi], sim2.x[3 * gi + 1], sim2.x[3 * gi + 2]];
  for (let f = 0; f < 8; f++) { const t = f / 7; sim2.grab = { i: gi, p: [p0[0] + 8 * t, p0[1] - 10 * t, p0[2] - 14 * t] }; sim2.wake(); sim2.step(1 / 60); sim2.computeNormals(); }
  const patch = sim2._gp ? sim2._gp.idx.length : 0;
  sim2.grab = null; sim2.wake();
  for (let f = 0; f < 300; f++) { sim2.step(1 / 60); sim2.computeNormals(); }
  const t2 = tangled(sim2, A.g, B.g);
  let nan = 0; for (let i = 0; i < sim2.N * 3; i++) if (!isFinite(sim2.x[i])) nan++;
  ok('захват пятном и рывок: слои распутываются после отпускания', patch > 3 && !nan && t2.bad < t2.n * 0.02, `пятно ${patch} т., перепутано ${t2.bad} из ${t2.n}`);
}

console.log('Капюшон');
for (const [id, extra] of [['over', { hood: 1 }], ['coat', { hood: 1, overlap: 0 }]]) {
  const pr = GARMENT_PRESETS.find((p) => p.id === id), mat = makeMaterial('ter320');
  const out = GENERATORS.top(body.m, { ...pr.p, ...extra });
  const g = { id, pieces: out.pieces, seams: out.seams, layer: 1 };
  for (const p of g.pieces) p.mat = mat.id;
  for (const sm of g.seams) sm.rev = seamRev(g, sm, body);
  const hs = g.seams.filter((x) => /Капюшон/.test(x.name)), worst = Math.max(...hs.map((x) => Math.abs(seamLengths(g, x).diff)));
  ok(`${id}: капюшон из двух половин, 5 швов, длины сходятся`, g.pieces.filter((p) => p.place.kind === 'hood').length === 2 && hs.length === 5 && worst < 0.35, `Δ ${worst.toFixed(2)}`);
  const sim = new Sim(body); sim.build([g], { [mat.id]: mat }, 2.6);
  for (let f = 0; f < 300; f++) { sim.step(1 / 60); sim.computeNormals(); }
  let gap = 0, nan = 0, hy = -1e9;
  for (let i = 0; i < sim.N * 3; i++) if (!isFinite(sim.x[i])) nan++;
  for (let c = 0; c < sim.sw.length; c += 2) { const a = 3 * sim.sw[c], b = 3 * sim.sw[c + 1]; gap = Math.max(gap, Math.hypot(sim.x[a] - sim.x[b], sim.x[a + 1] - sim.x[b + 1], sim.x[a + 2] - sim.x[b + 2])); }
  for (const r of sim.pieces) if (r.piece.place.kind === 'hood') for (let i = r.off; i < r.off + r.n; i++) hy = Math.max(hy, sim.x[3 * i + 1]);
  ok(`${id}: капюшон в 3D на голове, швы сошлись`, !nan && gap < 1.5 && hy > body.m.y.headC, `зазор ${gap.toFixed(2)} см, верх капюшона ${hy.toFixed(0)}`);
}

console.log('Импорт лекал: DXF, SVG, PDF');
{
  // DXF: наш экспорт → импорт — те же площади и припуски по сторонам
  const { g, mat } = make('tee');
  const d = dxf({ matsById: () => ({ [mat.id]: mat }) }, [{ g, size: 'M', pieces: g.pieces }]);
  const r = await importPatternFile('tee.dxf', d);
  const srcA = g.pieces.map((p) => Math.abs(pieceArea(p))).sort((a, b) => b - a), impA = r.pieces.map((p) => p.area).sort((a, b) => b - a);
  ok('DXF: все детали, площади совпадают (±1%)', r.pieces.length === g.pieces.length && srcA.every((a, i) => Math.abs(impA[i] - a) < a * 0.01), impA.map((a) => a.toFixed(0)).join(','));
  ok('DXF: единицы из заголовка — мм', r.unit === 'mm' && r.unitFromFile);
  const front = g.pieces.find((p) => p.name === 'Перед'), fi = r.pieces.find((p) => Math.abs(p.area - Math.abs(pieceArea(front))) < 5);
  const sas = edgesFromOutline(fi.outline, fi.sa, fi.cut).map((e) => e.sa).sort().join('/'), want = front.corners.map((c) => front.meta[c.id].sa).sort().join('/');
  ok('DXF: припуск каждой стороны — по расстоянию между линией шва и реза', sas === want, `${sas} vs ${want}`);
  // SVG как у FreeSewing (мм, y вниз, кривые, группы с transform); контрольный квадрат помечен
  const svg = readFileSync(new URL('../e2e/fixtures/tee-halves.svg', import.meta.url), 'utf8');
  const rs = await importPatternFile('tee.svg', svg);
  ok('SVG: 3 детали + контрольный квадрат 5×5 помечен', rs.pieces.length === 4 && rs.pieces.filter((p) => p.test).length === 1 && Math.abs(rs.pieces[0].h - 70) < 0.2 && Math.abs(rs.pieces[0].w - 25) < 0.2, rs.pieces.map((p) => `${p.w.toFixed(1)}×${p.h.toFixed(1)}`).join(' '));
  const sv = parseSVG(svg);
  ok('SVG: y перевёрнут (вверх), единицы мм', sv.unit === 'mm' && sv.paths.every((pp) => pp.pts.every((q) => q[1] <= 0)));
  // PDF: деталь отрезками (несжато) + форма XObject со сжатием (контур реза и линия шва) + рамка листа + квадрат + текст
  const mm = 72 / 25.4, seg = [[0, 0], [300, 0], [300, 400], [150, 480], [0, 400]].map(([x, y]) => [x * mm + 50, y * mm + 50]);
  let c1 = '0 0 0 RG 0.5 w\n';
  for (let i = 0; i < seg.length; i++) { const a = seg[i], b = seg[(i + 1) % seg.length]; c1 += `${a[0].toFixed(2)} ${a[1].toFixed(2)} m ${b[0].toFixed(2)} ${b[1].toFixed(2)} l S\n`; }
  c1 += `${(10 * mm).toFixed(2)} ${(10 * mm).toFixed(2)} ${(50 * mm).toFixed(2)} ${(50 * mm).toFixed(2)} re S\n0 0 ${(841 * mm).toFixed(2)} ${(1189 * mm).toFixed(2)} re S\n`;
  c1 += 'BT /F1 12 Tf 100 100 Td (Front) Tj ET\nq 1 0 0 1 400 0 cm /Fm1 Do Q\n';
  const sq = (x, y, w, h) => `${x} ${y} m ${x + w} ${y} l ${x + w} ${y + h} l ${x} ${y + h} l h S\n`;
  const fz = zlib.deflateSync(Buffer.from(sq(1200, 100, 200 * mm, 300 * mm) + sq(1200 + 10 * mm, 100 + 10 * mm, 180 * mm, 280 * mm)));
  let pdf = '%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  pdf += `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 ${(841 * mm).toFixed(2)} ${(1189 * mm).toFixed(2)}] >>\nendobj\n`;
  pdf += '3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /XObject << /Fm1 5 0 R >> >> >>\nendobj\n';
  pdf += `4 0 obj\n<< /Length ${c1.length} >>\nstream\n${c1}\nendstream\nendobj\n`;
  const bytes = new Uint8Array(Buffer.concat([Buffer.from(pdf + `5 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 3000 3000] /Filter /FlateDecode /Length ${fz.length} >>\nstream\n`, 'latin1'), fz, Buffer.from('\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1')]));
  const rp = await importPatternFile('a0.pdf', bytes);
  const big = rp.pieces.filter((p) => !p.test);
  ok('PDF: деталь из отрезков собрана, из формы со сжатием — по линии шва с припуском 1 см, рамка листа отброшена', big.length === 2 && Math.abs(big[0].w - 30) < 0.1 && Math.abs(big[0].h - 48) < 0.1 && big[1].sa === 1 && Math.abs(big[1].w - 18) < 0.1 && rp.pieces.some((p) => p.test), rp.pieces.map((p) => `${p.w.toFixed(1)}×${p.h.toFixed(1)}/${p.sa}`).join(' '));
  ok('PDF: углы пятиугольника — 5 сторон', edgesFromOutline(big[0].outline).length === 5);
  // лекало, разрезанное на листы A4: контуры не замыкаются → понятное предупреждение
  const open = '%PDF-1.4\n1 0 obj\n<< /Type /Page /MediaBox [0 0 595 842] /Contents 2 0 R >>\nendobj\n2 0 obj\n<< >>\nstream\n' + Array.from({ length: 30 }, (_, i) => `${10 + i * 15} 10 m ${10 + i * 15} 900 l S`).join('\n') + '\nendstream\nendobj\n';
  const ro = await importPatternFile('tiles.pdf', open);
  ok('PDF A4 со склейкой: детали не найдены, совет взять A0', !ro.pieces.length && ro.warn.some((w) => /A0/.test(w)));
}

console.log(`\n${pass} пройдено, ${fail} провалено`);
if (fail) process.exit(1);
