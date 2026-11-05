// @ts-check
import * as THREE from 'three';
import { Body, BODY_DEFAULT } from './body.js';
import { GARMENT_PRESETS, GENERATORS, GEN_DEFAULTS, buildPiece, seamOf, findPiece } from './patterns.js';
import { Sim, seamRev } from './sim.js';
import { SimProxy } from './simproxy.js';
import { makeMaterial, PRESETS, physics } from './materials.js';
import { View3D } from './view3d.js';
import { Editor2D } from './editor2d.js';
import { nestAll, collectItems, nestMaterial } from './layout.js';
import { buildAccessory, makeAcc, METALS } from './accessories.js';
import { deep, uid, debounce, bbox, setUidBase, fmt } from './util.js';
import * as UI from './ui.js';
import { defaultGrading, gradeGarment, sizesOf, expandSizes } from './grading.js';

const S = {
  body: deep(BODY_DEFAULT),
  materials: [],
  garments: [],
  accessories: [],
  images: {},
  settings: { showSA: true, showLen: true, quality: 2.6, shrinkComp: true, rotate: true, gap: 0.3, laborRate: 500 },
};
const app = {
  S, sel: {}, tool: 'select', tab: 'garments', mode2d: 'pattern',
  toolOpts: { brushColor: '#e9e4d8', brushW: 1.2, brushAlpha: 1, brushMode: 'paint', hwType: 'button', hwSize: 1.6, hwColor: '#1a1a1a', overlayMat: null, printW: 18 },
  history: [], future: [], imgRatio: {},
};
window.__app = app;

// ───────── core objects ─────────
const view3d = (app.view3d = new View3D(document.getElementById('v3d'), app));
const body = (app.body = new Body(view3d.scene));
let sim = null;
try {
  // eslint-disable-next-line no-undef
  if (typeof __WORKER_SRC__ === 'string' && typeof Worker !== 'undefined' && location.hash !== '#local') sim = new SimProxy(body, __WORKER_SRC__, () => S.garments);
} catch (e) { sim = null; }
if (!sim) sim = new Sim(body);
app.sim = sim;
sim.onBuilt = () => { view3d.sync(sim, app.matsById()); view3d.setStrain(view3d.showStrain); updatePlay(); };
const editor = (app.editor = new Editor2D(document.getElementById('c2d'), app));

app.matsById = () => Object.fromEntries(S.materials.map((m) => [m.id, m]));
// sizes for layout (тираж): qty per size; if nothing set → base size × 1
app.expandSizes = (g) => { g.grading ||= defaultGrading('M'); return expandSizes(g, body.m); };
app.geoVersion = 0;
const gradeCache = new Map();
app.graded = (g, sz) => {
  const key = g.id + ':' + sz;
  const c = gradeCache.get(key);
  if (c && c.v === app.geoVersion && c.n === g.pieces.length) return c.pieces;
  const pieces = gradeGarment(g, body.m, sz);
  gradeCache.set(key, { v: app.geoVersion, n: g.pieces.length, pieces });
  return pieces;
};
app.garment = (id) => S.garments.find((g) => g.id === id);
app.garmentOf = (p) => S.garments.find((g) => g.pieces.includes(p));
app.selPiece = () => (app.sel.p ? findPiece(S.garments, app.sel.p)?.p : null);
app.selPrint = () => { const p = app.selPiece(); return p && app.sel.print ? p.prints.find((x) => x.id === app.sel.print) : null; };
app.imageSize = (id) => app.imgRatio[id] || 1;

// ───────── history ─────────
const snap = () => JSON.stringify({ body: S.body, materials: S.materials, garments: S.garments, accessories: S.accessories });
app.commit = (label) => { app.history.push({ s: snap(), label }); if (app.history.length > 80) app.history.shift(); app.future = []; };
function restore(str) {
  const o = JSON.parse(str);
  const bodyChanged = JSON.stringify(o.body) !== JSON.stringify(S.body);
  Object.assign(S, o);
  if (bodyChanged) rebuildBody();
  app.select(app.sel.p && findPiece(S.garments, app.sel.p) ? app.sel : {});
  allTextures(); rebuildSim(); scheduleLayout(); UI.renderLeft(app);
}
app.undo = (silent) => {
  const h = app.history.pop(); if (!h) return;
  app.future.push({ s: snap(), label: h.label });
  restore(h.s);
  if (!silent) app.toast('Отменено: ' + h.label);
};
app.redo = () => { const f = app.future.pop(); if (!f) return; app.history.push({ s: snap(), label: f.label }); restore(f.s); app.toast('Повтор: ' + f.label); };

// ───────── selection ─────────
app.select = (o) => {
  view3d.invalidate(3);
  app.sel = { ...o };
  if (o.p && !o.g) { const f = findPiece(S.garments, o.p); if (f) app.sel.g = f.g.id; }
  editor.dirty = true;
  UI.renderRight(app);
  UI.renderTree(app);
};

// ───────── pipeline ─────────
function allTextures() {
  const mats = app.matsById();
  for (const g of S.garments) for (const p of g.pieces) view3d.updateTexture(p, mats, S.images, () => { allTextures(); editor.dirty = true; });
  editor.dirty = true;
}
app.updateTex = (ids) => {
  const mats = app.matsById();
  for (const id of ids) { const f = findPiece(S.garments, id); if (f) view3d.updateTexture(f.p, mats, S.images, () => app.updateTex([id])); }
  editor.dirty = true;
};
function buildAccessories() {
  body.extraCaps = [];
  sim.belts = [];
  const mats = app.matsById();
  const groups = [];
  const matFor = (acc, fallback) => {
    const m = mats[acc.mat];
    if (!m) return new THREE.MeshStandardMaterial({ color: fallback, roughness: 0.55 });
    const ph = physics(m);
    return new THREE.MeshStandardMaterial({ color: m.color, roughness: ph.rough, metalness: 0 });
  };
  let hasShoes = false;
  for (const a of S.accessories) {
    if (a.visible === false) continue;
    if (a.type === 'shoes') hasShoes = true;
    const mats3 = {
      leather: matFor(a, '#141414'),
      sole: new THREE.MeshStandardMaterial({ color: a.p.soleColor || '#e9e5dc', roughness: 0.7 }),
      knit: matFor(a, '#202020'),
      metal: (k) => { const M = METALS[k] || METALS.silver; return new THREE.MeshStandardMaterial({ color: M.color, metalness: 1, roughness: M.rough }); },
    };
    groups.push(buildAccessory(a, body, mats3, sim));
  }
  body.setFeetVisible(!hasShoes);
  body.buildGrid();
  view3d.setAccessories(groups);
  if (sim.syncBody) sim.syncBody(S.body);
}
app.rebuildAccessories = () => { buildAccessories(); sim.wake(); view3d.invalidate(3); };
function rebuildBody() {
  app.geoVersion++;
  body.build(S.body);
  buildAccessories();
  sim.wake();
}
function rebuildSim(fresh = false) {
  const prev = !fresh && sim.N ? sim.snapshot() : null;
  for (const g of S.garments) for (const s of g.seams) if (s.rev == null) s.rev = seamRev(g, s, body);
  const mats = app.matsById();
  for (const g of S.garments) for (const p of g.pieces) if (!view3d.texCache.has(p.id)) view3d.updateTexture(p, mats, S.images);
  if (sim.isWorker) sim.bodyParams = JSON.parse(JSON.stringify(S.body));
  sim.build(S.garments, mats, S.settings.quality, prev);
  if (!sim.isWorker) sim.onBuilt();
}
app.rebuildSim = rebuildSim;
const geoDebounced = debounce(() => { rebuildSim(); scheduleLayout(); }, 90);
let liveT = 0;
app.live = () => { app.geoVersion++; const now = performance.now(); if (now - liveT > 140) { liveT = now; rebuildSim(); } };
app.liveTex = (p) => { const now = performance.now(); if (now - liveT > 90) { liveT = now; app.updateTex([p.id]); } };
app.brushLive = () => {};
app.changed = (o = {}) => {
  view3d.invalidate(3);
  if (o.geo || o.view || o.grade) app.geoVersion++;
  if (o.tex) app.updateTex(o.tex);
  if (o.allTex) allTextures();
  if (o.geo) geoDebounced();
  if (o.hw) view3d.buildHardware(sim);
  if (o.mats) { allTextures(); geoDebounced(); }
  if (o.view) {}
  editor.dirty = true;
  UI.renderRight(app); UI.renderTree(app);
  autosave();
  if (o.geo || o.mats || o.layout || o.grade) scheduleLayout();
};
app.setBody = (patch, commit = true) => {
  view3d.invalidate(3);
  if (commit) app.commit('Манекен');
  Object.assign(S.body, patch);
  rebuildBody();
  UI.renderBodyReadout(app);
  autosave();
};

// ───────── layout (marker) ─────────
// раскладка — в фоновом потоке (на тираже S+M+L это 1–2 с счёта); #local — в основном, для отладки
const layoutOpt = () => ({ shrink: S.settings.shrinkComp, rotate: S.settings.rotate, gap: S.settings.gap });
let layoutWorker = null, layoutSeq = 0;
if (typeof __LAYOUT_SRC__ === 'string' && typeof Worker !== 'undefined' && location.hash !== '#local') {
  try { layoutWorker = new Worker(URL.createObjectURL(new Blob([__LAYOUT_SRC__], { type: 'text/javascript' }))); } catch (e) { layoutWorker = null; }
}
const layoutDone = (res) => {
  app.layout = res;
  UI.renderWaste(app);
  if (app.tab === 'layout') UI.renderLeft(app);
  if (app.mode2d === 'layout') UI.drawLayout(app);
};
const layoutWaiters = new Map();
if (layoutWorker) layoutWorker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'nest' && m.seq === layoutSeq) layoutDone(m.res);
  else if (m.type === 'error') { console.error('layout worker', m.message); if (m.seq === layoutSeq) layoutDone([]); }
  const w = layoutWaiters.get(m.seq); if (w) { layoutWaiters.delete(m.seq); w(m); }
};
// garments уходят в поток как JSON: в них бывают служебные поля с функциями (_ctx физики)
const plainGarments = () => JSON.parse(JSON.stringify(S.garments.filter((g) => g.visible !== false)));
const scheduleLayout = debounce(() => {
  if (layoutWorker) { layoutWorker.postMessage({ type: 'nest', seq: ++layoutSeq, garments: plainGarments(), mats: app.matsById(), opt: layoutOpt(), M: body.m }); return; }
  try { layoutDone(nestAll(S.garments, app.matsById(), layoutOpt(), app.expandSizes)); } catch (e) { console.error(e); layoutDone([]); }
}, 450);
// подбор ширины рулона (несколько раскладок) — тоже в фоне; возвращает Promise со строками [{w, length, util, wasteGrams}]
app.widthOptions = (matId, widths) => new Promise((resolve) => {
  if (layoutWorker) { const seq = ++layoutSeq + 1e6; layoutWaiters.set(seq, (m) => resolve(m.rows || [])); layoutWorker.postMessage({ type: 'widths', seq, matId, widths, garments: plainGarments(), mats: app.matsById(), opt: layoutOpt() }); return; }
  const items = collectItems(S.garments, app.matsById()).find((x) => x.mat.id === matId)?.items || [];
  const mat = S.materials.find((x) => x.id === matId);
  resolve(widths.map((w) => [w, nestMaterial(items, { ...mat, width: w }, layoutOpt())]).filter(([, r]) => !r.placed.some((x) => x.fail)).map(([w, r]) => ({ w, length: r.length, util: r.util, wasteGrams: r.wasteGrams })));
});
app.scheduleLayout = scheduleLayout;

// ───────── garments / materials ─────────
app.ensureMaterial = (presetId) => {
  let m = S.materials.find((x) => x.presetId === presetId);
  if (!m) { m = makeMaterial(presetId); S.materials.push(m); }
  return m;
};
app.addGarment = (presetId) => {
  const pr = GARMENT_PRESETS.find((p) => p.id === presetId);
  app.commit('Добавить: ' + pr.name);
  const mat = app.ensureMaterial(pr.mat);
  const g = { id: uid('g'), gen: pr.gen, preset: pr.id, name: pr.name, params: { ...pr.p }, layer: pr.layer, visible: true, pieces: [], seams: [], viewOff: { x: 0, y: 0 }, baseMat: mat.id, grading: defaultGrading('M') };
  let maxX = -Infinity;
  for (const og of S.garments) for (const p of og.pieces) { const b = bbox(p.pts); maxX = Math.max(maxX, b.x1 + p.view.x); }
  g.viewOff.x = isFinite(maxX) ? maxX + 40 : 0;
  generate(g, mat.id);
  S.garments.push(g);
  allTextures(); rebuildSim(); scheduleLayout();
  app.select({ g: g.id });
  UI.renderLeft(app);
  autosave();
  return g;
};
function fillParams(g) {
  const d = GEN_DEFAULTS[g.gen];
  if (d) for (const k in d) if (g.params[k] == null) g.params[k] = d[k];
}
function generate(g, matId) {
  fillParams(g);
  const out = GENERATORS[g.gen](body.m, g.params);
  const oldMats = {};
  for (const p of g.pieces) oldMats[p.name] = p.mat;
  for (const p of out.pieces) {
    p.base = p.name;
    // своя ткань детали из генератора (мешковина) — только если пользователь ещё не назначил другую
    const own = p.matPreset ? app.ensureMaterial(p.matPreset).id : null;
    p.mat = oldMats[p.name] || own || matId || g.baseMat;
    p.view.x += g.viewOff.x; p.view.y += g.viewOff.y;
    delete p._edgeIds; delete p._tags; delete p.matPreset;
  }
  g.pieces = out.pieces; g.seams = out.seams;
  g.stepLabels = out.stepLabels || null; g.stepNotes = out.stepNotes || null; g.trims = out.trims || null;
  // раскладка на столе: ряд 1 — детали на теле (y = высота на теле); ряд 2 под ним — пояс и внутренние детали
  let cur = g.viewOff.x, cur2 = g.viewOff.x;
  for (const p of g.pieces) {
    const b = bbox(p.pts);
    if (p.inner || p.place.kind === 'band') { p.view.x = cur2 - b.x0; p.view.y = g.viewOff.y - 16 - b.y1; cur2 += b.w + 7; }
    else { p.view.x = cur - b.x0; cur += b.w + 9; }
  }
  for (const s of g.seams) s.rev = seamRev(g, s, body);
}
app.regenerate = (g, commit = true) => {
  if (commit) app.commit('Параметры изделия');
  for (const p of g.pieces) view3d.texCache.delete(p.id);
  generate(g);
  allTextures(); rebuildSim(true); scheduleLayout(); UI.renderTree(app); editor.dirty = true; autosave();
};
app.regenDebounced = debounce((g) => app.regenerate(g, false), 160);
app.removeGarment = (g) => {
  app.commit('Удалить изделие');
  S.garments = S.garments.filter((x) => x !== g);
  app.select({}); rebuildSim(); scheduleLayout(); UI.renderLeft(app); editor.dirty = true; autosave();
  app.toast(`Удалено целиком: ${g.name} (${g.pieces.length} дет.)`, '', { label: 'Вернуть', fn: () => app.undo() });
};
app.addSeam = (g, a, b) => {
  app.commit('Новый шов');
  g.seams = g.seams.filter((s) => !((s.a.p === a.p && s.a.e === a.e) || (s.b.p === a.p && s.b.e === a.e) || (s.a.p === b.p && s.a.e === b.e) || (s.b.p === b.p && s.b.e === b.e)));
  const s = { id: uid('s'), a, b, rev: null, name: 'Пользовательский шов', order: 9 };
  s.rev = seamRev(g, s, body);
  g.seams.push(s);
  app.toast('Шов создан', 'pos');
  app.changed({ geo: true });
};
app.addRectPiece = (g, w, h, place) => {
  app.commit('Новая деталь');
  const y0 = place === 'arm' ? -h : body.m.y.waist - h / 2;
  const x0 = -w / 2;
  const p = buildPiece('Деталь ' + w + '×' + h, [
    { pts: [[x0, y0], [x0 + w, y0]], name: 'низ' }, { pts: [[x0 + w, y0], [x0 + w, y0 + h]], name: 'сторона' },
    { pts: [[x0 + w, y0 + h], [x0, y0 + h]], name: 'верх' }, { pts: [[x0, y0 + h], [x0, y0]], name: 'сторона' },
  ], { place: place === 'none' ? { kind: 'free' } : { kind: 'torso', side: place }, view: { x: g.viewOff.x - w - 20, y: 0 } });
  delete p._edgeIds;
  p.mat = g.baseMat || S.materials[0].id;
  g.pieces.push(p);
  app.updateTex([p.id]);
  app.select({ g: g.id, p: p.id });
  app.changed({ geo: true });
};
app.addOverlay = (g, p, pts) => {
  app.commit('Накладка');
  const mat = app.toolOpts.overlayMat && S.materials.find((m) => m.id === app.toolOpts.overlayMat) ? app.toolOpts.overlayMat : p.mat;
  const o = { id: uid('o'), name: 'Накладка ' + ((p.overlays?.length || 0) + 1), pts, mat, sa: 1 };
  (p.overlays ||= []).push(o);
  app.select({ g: g.id, p: p.id, overlay: o.id });
  app.changed({ tex: [p.id], layout: true });
};
app.addStroke = (g, p, pts) => {
  app.commit('Кисть');
  const o = app.toolOpts;
  (p.strokes ||= []).push({ id: uid('k'), pts, color: o.brushColor, w: o.brushW, alpha: o.brushAlpha, mode: o.brushMode });
  app.select({ g: g.id, p: p.id });
  app.changed({ tex: [p.id] });
};
app.pendingPrint = null;
app.placePrint = (g, p, at) => {
  if (!app.pendingPrint) { app._printTarget = { g, p, at }; document.getElementById('fileImg').click(); return; }
  app.commit('Принт');
  const pr = { id: uid('r'), img: app.pendingPrint, x: at[0], y: at[1], w: app.toolOpts.printW, rot: 0, opacity: 1 };
  p.prints.push(pr);
  app.select({ g: g.id, p: p.id, print: pr.id });
  app.changed({ tex: [p.id] });
};
app.scalePrint = (pr, k) => { pr.w = Math.max(1, pr.w * k); const p = app.selPiece(); if (p) app.liveTex(p); editor.dirty = true; UI.renderRight(app); };
app.loadImage = (file, cb) => {
  const rd = new FileReader();
  rd.onload = () => {
    const id = uid('img');
    S.images[id] = rd.result;
    const im = new Image();
    im.onload = () => { app.imgRatio[id] = im.height / im.width; cb && cb(id); };
    im.src = /** @type {string} */ (rd.result);
  };
  rd.readAsDataURL(file);
};
document.getElementById('fileImg').addEventListener('change', (e) => {
  const inp = /** @type {HTMLInputElement} */ (e.target), f = inp.files[0]; inp.value = '';
  if (!f) return;
  app.loadImage(f, (id) => {
    app.pendingPrint = id;
    const t = app._printTarget; app._printTarget = null;
    if (t) app.placePrint(t.g, t.p, t.at);
    else app.toast('Изображение загружено — кликните по детали, чтобы разместить', 'pos');
    UI.renderLeft(app);
  });
});

// ───────── 3D interactions ─────────
const grabPlane = new THREE.Plane(), tmpV = new THREE.Vector3();
let paint3d = null;
app.onClothDown = (hit, e) => {
  const rec = hit.object.userData.rec;
  if (app.tool === 'brush') {
    const uv2 = barycentric2D(hit, rec);
    paint3d = { rec, pts: [uv2] };
    return true;
  }
  if (e.shiftKey || app.tool === 'select') {
    if (!e.shiftKey && !e.altKey) { app.select({ g: rec.garment.id, p: rec.piece.id }); }
    const f = hit.face, ids = [f.a, f.b, f.c];
    let best = ids[0], bd = Infinity;
    for (const i of ids) { const k = (rec.off + i) * 3; const d = (sim.x[k] - hit.point.x) ** 2 + (sim.x[k + 1] - hit.point.y) ** 2 + (sim.x[k + 2] - hit.point.z) ** 2; if (d < bd) { bd = d; best = i; } }
    if (!e.altKey) return false; // plain click = select (and orbit); Alt+drag = pull fabric
    sim.grab = { i: rec.off + best, p: [hit.point.x, hit.point.y, hit.point.z] };
    view3d.camera.getWorldDirection(tmpV);
    grabPlane.setFromNormalAndCoplanarPoint(tmpV, hit.point);
    sim.wake();
    return true;
  }
  return false;
};
app.onClothMove = (ray) => {
  if (sim.grab) { const p = new THREE.Vector3(); if (ray.ray.intersectPlane(grabPlane, p)) sim.grab = { ...sim.grab, p: [p.x, p.y, p.z] }; return; }
  if (paint3d) {
    const hit = ray.intersectObject(view3d.meshes.get(paint3d.rec.piece.id).mesh, false)[0];
    if (hit) { paint3d.pts.push(barycentric2D(hit, paint3d.rec)); }
  }
};
app.onClothUp = () => {
  if (sim.grab) { sim.grab = null; sim.wake(); }
  if (paint3d && paint3d.pts.length > 1) { const g = paint3d.rec.garment, p = paint3d.rec.piece; app.addStroke(g, p, paint3d.pts); }
  paint3d = null;
};
app.onClick3D = (hit) => {
  if (!hit) { return; }
  const rec = hit.object.userData.rec;
  app.select({ g: rec.garment.id, p: rec.piece.id });
};
function barycentric2D(hit, rec) {
  const f = hit.face, v2 = rec.mesh.v2;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  const k = (i) => (rec.off + i) * 3;
  A.set(sim.x[k(f.a)], sim.x[k(f.a) + 1], sim.x[k(f.a) + 2]); B.set(sim.x[k(f.b)], sim.x[k(f.b) + 1], sim.x[k(f.b) + 2]); C.set(sim.x[k(f.c)], sim.x[k(f.c) + 1], sim.x[k(f.c) + 2]);
  const bc = new THREE.Vector3();
  THREE.Triangle.getBarycoord(hit.point, A, B, C, bc);
  return [bc.x * v2[2 * f.a] + bc.y * v2[2 * f.b] + bc.z * v2[2 * f.c], bc.x * v2[2 * f.a + 1] + bc.y * v2[2 * f.b + 1] + bc.z * v2[2 * f.c + 1]];
}

// ───────── main loop ─────────
let last = performance.now(), fps = 60, fpsAcc = 0, fpsN = 0;
function loop(t) {
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  const t0 = performance.now();
  const moved = sim.step(1 / 60);
  // прокси физики сообщает о новых позициях сам; локальный решатель двигает ткань, пока не успокоится
  view3d.frame(sim, sim.isWorker ? moved === true : !!sim.N && sim.running && !sim.settled);
  fpsAcc += performance.now() - t0; fpsN++;
  if (fpsN >= 20) { fps = 1000 / Math.max(16.7, fpsAcc / fpsN); fpsAcc = 0; fpsN = 0; UI.renderStats(app, fps); }
  void dt;
  requestAnimationFrame(loop);
}
function updatePlay() {
  const b = document.getElementById('bPlay');
  b.textContent = sim.running ? '❚❚ Симуляция' : '▶ Симуляция';
  b.classList.toggle('on', !sim.running);
}
app.updatePlay = updatePlay;

// ───────── persistence & files ─────────
const autosave = debounce(() => { try { localStorage.setItem('kromka.v1', JSON.stringify({ ...JSON.parse(snap()), images: S.images, settings: S.settings })); } catch (e) { /* storage unavailable */ } }, 800);
app.autosave = autosave;
app.loadProject = (o) => {
  app.commit('Открыть проект');
  S.body = o.body || deep(BODY_DEFAULT); S.materials = o.materials || []; S.garments = o.garments || []; S.accessories = o.accessories || []; S.images = o.images || {};
  if (o.settings) Object.assign(S.settings, o.settings);
  let maxId = 0; JSON.stringify(o).replace(/"[a-z]+([0-9a-z]+)"/g, () => ''); setUidBase(maxId + 1000);
  for (const id in S.images) { const im = new Image(); im.onload = () => { app.imgRatio[id] = im.height / im.width; }; im.src = S.images[id]; }
  for (const g of S.garments) { g.grading ||= defaultGrading('M'); fillParams(g); for (const p of g.pieces) if (!p.base) p.base = p.name.split(' · ')[0]; }
  view3d.texCache.clear();
  rebuildBody(); allTextures(); rebuildSim(true); scheduleLayout(); app.select({}); UI.renderLeft(app); editor.fit(); view3d.frameBody(body);
};
let dlNS;
app.save = async (filename, data) => {
  try {
    if (dlNS === undefined) dlNS = window.claude?.use ? await window.claude.use('downloads') : null;
    if (dlNS) { await dlNS.save({ filename, data }); app.toast('Сохранено: ' + filename, 'pos'); return; }
  } catch (e) { if (e?.code === 'declined') { app.toast('Сохранение отменено'); return; } }
  try {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { app.toast('Не удалось сохранить файл в этом окне', 'neg'); }
};
document.getElementById('fileProj').addEventListener('change', (e) => {
  const inp = /** @type {HTMLInputElement} */ (e.target), f = inp.files[0]; inp.value = ''; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => { try { app.loadProject(JSON.parse(/** @type {string} */ (rd.result))); app.toast('Проект открыт', 'pos'); } catch (err) { app.toast('Не удалось прочитать файл проекта', 'neg'); } };
  rd.readAsText(f);
});

// ───────── toast ─────────
let toastT;
// action: { label, fn } — кнопка в сообщении (например «Вернуть» после удаления); такое сообщение висит дольше
app.toast = (msg, kind = '', action = null) => {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'show ' + kind + (action ? ' act' : '');
  if (action) {
    const b = document.createElement('button');
    b.className = 'sm'; b.textContent = action.label;
    b.onclick = () => { el.className = ''; action.fn(); };
    el.append(' ', b);
  }
  clearTimeout(toastT); toastT = setTimeout(() => { el.className = ''; }, action ? 6000 : 2600);
};

// ───────── boot ─────────
function boot() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('kromka.v1') || localStorage.getItem('obrazec.v1') || 'null'); } catch (e) { saved = null; }
  UI.init(app);
  body.build(S.body);
  if (saved && saved.garments?.length) {
    S.body = saved.body; S.materials = saved.materials; S.garments = saved.garments; S.accessories = saved.accessories || []; S.images = saved.images || {};
    if (saved.settings) Object.assign(S.settings, saved.settings);
    setUidBase(5000);
    for (const g of S.garments) { g.grading ||= defaultGrading('M'); fillParams(g); for (const p of g.pieces) if (!p.base) p.base = p.name.split(' · ')[0]; }
    for (const id in S.images) { const im = new Image(); im.onload = () => { app.imgRatio[id] = im.height / im.width; app.updateTex(S.garments.flatMap((g) => g.pieces.filter((p) => p.prints.some((r) => r.img === id)).map((p) => p.id))); }; im.src = S.images[id]; }
    body.build(S.body);
    buildAccessories(); allTextures(); rebuildSim(true);
  } else {
    starter();
  }
  app.history = [];
  view3d.frameBody(body);
  setTimeout(() => editor.fit(), 50);
  scheduleLayout();
  UI.renderLeft(app); UI.renderRight(app);
  requestAnimationFrame(loop);
}
function starter() {
  app.ensureMaterial('jer260');
  const lth = app.ensureMaterial('horse12');
  S.accessories.push({ ...makeAcc('shoes', lth.id), p: { style: 'high', toe: 'round', shaft: 17, sole: 3.4, heel: 0, flare: 0.8, laces: 1, soleColor: '#e9e5dc' } });
  buildAccessories();
  const pants = app.addGarment('dropc');
  const top = app.addGarment('long');
  const ecru = S.materials.find((m) => m.presetId === 'vis180');
  if (ecru) { ecru.color = '#d6cfc1'; ecru.name = 'Вискозный джерси, экрю'; }
  const blk = S.materials.find((m) => m.presetId === 'jer260');
  if (blk) { blk.color = '#2b2a28'; blk.finish = 'garmentdye'; blk.name = 'Пенье плотное, garment dye'; blk.shrink = null; }
  for (const m of S.materials) if (!m.shrink) m.shrink = [5.5, 7];
  allTextures();
  void pants; void top;
  app.select({});
}
boot();
export { app, S, PRESETS, seamOf, fmt };
