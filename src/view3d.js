// @ts-check
// 3D viewport: renderer, lights, garment meshes bound to simulator buffers, hardware, picking, grab
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { normalMap, physics } from './materials.js';
import { pieceCanvas } from './textures.js';

/** отступ слоя при отрисовке, см: каждый следующий слой — на 0,3 см дальше от тела */
const layerOff = (rec) => Math.min(4, Math.max(0, rec?.layer ?? rec?.garment?.layer ?? 0)) * 0.3; // ранг слоя из физики

export class View3D {
  constructor(el, app) {
    this.el = el; this.app = app;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }));
    // чёткость: не выше 2× и не выше экрана; на слабой графике снижается сама (см. _adapt)
    this.dprMax = Math.min(2, window.devicePixelRatio || 1); this.dpr = this.dprMax;
    r.setPixelRatio(this.dpr);
    this._dirty = 3; this._lastRender = 0; this._slow = 0; this._fast = 0; this._lastT = 0;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.25;
    r.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(r.domElement);
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x0c0c0d);
    scene.fog = new THREE.Fog(0x0c0c0d, 600, 1400);
    this.camera = new THREE.PerspectiveCamera(30, 1, 5, 4000);
    this.camera.position.set(150, 150, 330);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.target.set(0, 100, 0);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 40; this.controls.maxDistance = 900;
    this.controls.maxPolarAngle = Math.PI * 0.53;
    scene.add(new THREE.HemisphereLight(0xe6e2da, 0x22201d, 1.25));
    const key = new THREE.DirectionalLight(0xfff4e6, 2.6);
    key.position.set(160, 320, 220); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -120, right: 120, top: 220, bottom: -20, near: 50, far: 900 });
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.6;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xc4ceff, 1.8); rim.position.set(-260, 220, -260); scene.add(rim);
    const back = new THREE.DirectionalLight(0xfff0e0, 1.1); back.position.set(220, 160, -300); scene.add(back);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6); fill.position.set(-200, 80, 260); scene.add(fill);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(170, 64), new THREE.MeshStandardMaterial({ color: 0x161617, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    const grid = new THREE.PolarGridHelper(170, 12, 8, 64, 0x2a2a2c, 0x202022); grid.position.y = 0.05; scene.add(grid);
    this.ground = ground;
    this.clothGroup = new THREE.Group(); scene.add(this.clothGroup);
    this.accGroup = new THREE.Group(); scene.add(this.accGroup);
    this.meshes = new Map(); // pieceId → {mesh, rec}
    this.texCache = new Map();
    this.ray = new THREE.Raycaster();
    this.ptr = new THREE.Vector2();
    this.showStrain = false;
    this.hwMeshes = [];
    this._bindPointer();
    // перерисовка по требованию: любая правка сцены, камеры, указателя помечает кадр
    this.controls.addEventListener('change', () => this.invalidate());
    for (const ev of ['pointerdown', 'pointermove', 'wheel']) r.domElement.addEventListener(ev, () => this.invalidate(), { passive: true });
    for (const k of Object.getOwnPropertyNames(View3D.prototype)) {
      if (['constructor', 'frame', 'invalidate', '_adapt', '_bindPointer'].includes(k) || typeof this[k] !== 'function') continue;
      const f = this[k];
      this[k] = (...a) => { const out = f.apply(this, a); this.invalidate(); return out; };
    }
    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
  }
  invalidate(frames = 2) { this._dirty = Math.max(this._dirty, frames); }
  resize() {
    const w = this.el.clientWidth || 300, h = this.el.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px'; this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  // rebuild garment meshes after sim.build
  sync(sim, matsById) {
    for (const { mesh } of this.meshes.values()) { this.clothGroup.remove(mesh); mesh.geometry.dispose(); }
    this.meshes.clear();
    for (const rec of sim.pieces) {
      const g = new THREE.BufferGeometry();
      const pos = new THREE.BufferAttribute(sim.x.subarray(rec.off * 3, (rec.off + rec.n) * 3), 3);
      pos.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', pos);
      const nrm = new THREE.BufferAttribute(sim.nrm.subarray(rec.off * 3, (rec.off + rec.n) * 3), 3);
      nrm.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('normal', nrm);
      const ow = new THREE.BufferAttribute(sim.outward.subarray(rec.off * 3, (rec.off + rec.n) * 3), 3);
      ow.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('outward', ow);
      g.setIndex(new THREE.BufferAttribute(rec.mesh.tris, 1));
      const col = new Float32Array(rec.n * 3).fill(1);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const mesh = new THREE.Mesh(g, this.material(rec.piece, matsById, layerOff(rec)));
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.rec = rec;
      mesh.frustumCulled = false;
      this.applyUV(mesh, rec, matsById);
      this.clothGroup.add(mesh);
      this.meshes.set(rec.piece.id, { mesh, rec });
    }
    this.buildHardware(sim);
  }
  applyUV(mesh, rec, matsById) {
    const tex = this.texCache.get(rec.piece.id);
    const v2 = rec.mesh.v2, n = rec.n;
    const uv = new Float32Array(n * 2), uv1 = new Float32Array(n * 2);
    const ph = physics(matsById[rec.piece.mat] || Object.values(matsById)[0]);
    const tile = ph.tile || 0.5;
    const g = ((rec.piece.grain || 0) * Math.PI) / 180, c = Math.cos(g), s = Math.sin(g);
    for (let i = 0; i < n; i++) {
      const x = v2[2 * i], y = v2[2 * i + 1];
      if (tex) { uv[2 * i] = (x - tex.x0) / tex.w; uv[2 * i + 1] = (y - tex.y0) / tex.h; }
      uv1[2 * i] = (x * c - y * s) / tile; uv1[2 * i + 1] = (x * s + y * c) / tile;
    }
    mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    mesh.geometry.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  }
  material(piece, matsById, off = 0) {
    const m = matsById[piece.mat] || Object.values(matsById)[0];
    const ph = physics(m);
    const nm = normalMap(ph.tex);
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: ph.rough, metalness: 0, side: THREE.DoubleSide,
      normalMap: nm, normalScale: new THREE.Vector2(ph.tex === 'leather' ? 0.22 : ph.tex === 'suede' ? 0.3 : 0.55, ph.tex === 'leather' ? 0.22 : ph.tex === 'suede' ? 0.3 : 0.55),
      sheen: ph.sheen * 0.8, sheenRoughness: 0.55, sheenColor: new THREE.Color(m.color).lerp(new THREE.Color(0xffffff), 0.35),
      vertexColors: false,
    });
    mat.normalMap.channel = 1;
    const tex = this.texCache.get(piece.id);
    if (tex) mat.map = tex.texture;
    if (m.cons === 'chiffon' || m.cons === 'mesh') { mat.transparent = true; mat.opacity = m.cons === 'mesh' ? 0.78 : 0.62; mat.depthWrite = false; }
    // слой изделия при отрисовке чуть отодвигается наружу (от тела): тонкие пересечения слоёв, которые физика
    // не успела развести, не видны. Геометрия и физика не меняются — только вершинный шейдер.
    mat.userData.layerOff = { value: off };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uLayerOff = mat.userData.layerOff;
      sh.vertexShader = 'attribute vec3 outward;\nuniform float uLayerOff;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += outward * uLayerOff;');
    };
    mat.customProgramCacheKey = () => 'cloth-layer';
    return mat;
  }
  updateTexture(piece, matsById, images, onImg) {
    const t = pieceCanvas(piece, matsById, images, onImg);
    const prev = this.texCache.get(piece.id);
    if (prev) prev.texture.dispose();
    const texture = new THREE.CanvasTexture(t.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    this.texCache.set(piece.id, { ...t, texture });
    const e = this.meshes.get(piece.id);
    if (e) {
      e.mesh.material.dispose();
      e.mesh.material = this.material(piece, matsById, layerOff(e.rec));
      this.applyUV(e.mesh, e.rec, matsById);
      this.setStrain(this.showStrain);
    }
    return t;
  }
  frame(sim, moved = true) {
    if (sim && sim.N && moved) {
      sim.computeNormals();
      for (const { mesh } of this.meshes.values()) {
        mesh.geometry.attributes.position.needsUpdate = true;
        mesh.geometry.attributes.normal.needsUpdate = true;
        mesh.geometry.attributes.outward.needsUpdate = true;
      }
      if (this.showStrain) this.updateStrain(sim);
      this.updateHardware(sim);
    }
    if (sim && sim.N && moved) this._dirty = Math.max(this._dirty, 1);
    if (this.controls.update()) this._dirty = Math.max(this._dirty, 2);
    const now = performance.now();
    // в покое рисуем 4 кадра/с (страховка от пропущенной пометки), иначе — только когда что-то изменилось
    if (this._dirty <= 0 && now - this._lastRender < 250) { this._lastT = 0; return false; }
    this.renderer.render(this.scene, this.camera);
    this._adapt(now);
    this._lastRender = now; this._dirty = Math.max(0, this._dirty - 1);
    return true;
  }
  // слабая графика (встроенная UHD и т. п.): если кадры подряд идут медленнее ~30 к/с — снижаем чёткость шагами до 1×;
  // долго быстро — возвращаем
  _adapt(now) {
    const dt = this._lastT ? now - this._lastT : 0;
    this._lastT = now;
    if (!dt || dt > 250) return;
    if (dt > 34) { this._slow++; this._fast = 0; } else if (dt < 20) { this._fast++; this._slow = Math.max(0, this._slow - 1); }
    let next = this.dpr;
    if (this._slow > 45 && this.dpr > 1) next = Math.max(1, this.dpr - 0.25);
    else if (this._fast > 600 && this.dpr < this.dprMax) next = Math.min(this.dprMax, this.dpr + 0.25);
    if (next !== this.dpr) { this.dpr = next; this.renderer.setPixelRatio(next); this.resize(); this._slow = 0; this._fast = 0; }
  }
  setStrain(on) {
    this.showStrain = on;
    for (const { mesh } of this.meshes.values()) { mesh.material.vertexColors = on; mesh.material.needsUpdate = true; }
  }
  updateStrain(sim) {
    const all = new Float32Array(sim.N * 3);
    sim.strainColors(all);
    for (const { mesh, rec } of this.meshes.values()) {
      mesh.geometry.attributes.color.array.set(all.subarray(rec.off * 3, (rec.off + rec.n) * 3));
      mesh.geometry.attributes.color.needsUpdate = true;
    }
  }
  // hardware (buttons, eyelets, rivets, snaps) bound to triangles via barycentric coords
  buildHardware(sim) {
    for (const m of this.hwMeshes) this.clothGroup.remove(m.mesh);
    this.hwMeshes = [];
    const metal = (c) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.9, roughness: 0.3 });
    const geos = {
      button: new THREE.CylinderGeometry(1, 1, 0.35, 20), snap: new THREE.CylinderGeometry(1, 1, 0.45, 20),
      eyelet: new THREE.TorusGeometry(0.75, 0.25, 8, 20), rivet: new THREE.SphereGeometry(0.6, 12, 8), zipper: new THREE.BoxGeometry(1, 2.2, 0.28),
    };
    for (const rec of sim.pieces) {
      for (const h of rec.piece.hardware || []) {
        const loc = locateTri(rec.mesh, h.x, h.y);
        if (!loc) continue;
        const g = geos[h.type] || geos.button;
        const mat = h.type === 'button' ? new THREE.MeshStandardMaterial({ color: h.color || '#1a1a1a', roughness: 0.5 }) : metal(h.color || '#8f8f92');
        const mesh = new THREE.Mesh(g, mat);
        const s = (h.size || 1.6) / 2;
        mesh.scale.set(s, h.type === 'eyelet' ? s : s, s);
        mesh.castShadow = true;
        this.clothGroup.add(mesh);
        this.hwMeshes.push({ mesh, off: rec.off, loc, type: h.type, s, lo: layerOff(rec) });
      }
    }
  }
  updateHardware(sim) {
    const up = new THREE.Vector3(0, 1, 0), n = new THREE.Vector3(), p = new THREE.Vector3();
    const zx = new THREE.Vector3(), zy = new THREE.Vector3(), zm = new THREE.Matrix4();
    for (const h of this.hwMeshes) {
      const [a, b, c] = h.loc.tri.map((i) => (h.off + i) * 3);
      const [l1, l2, l3] = h.loc.w;
      p.set(0, 0, 0); n.set(0, 0, 0);
      for (let k = 0; k < 3; k++) { p.setComponent(k, l1 * sim.x[a + k] + l2 * sim.x[b + k] + l3 * sim.x[c + k]); n.setComponent(k, l1 * sim.outward[a + k] + l2 * sim.outward[b + k] + l3 * sim.outward[c + k]); }
      n.normalize();
      h.mesh.position.copy(p).addScaledVector(n, 0.25 + (h.lo || 0));
      if (h.type === 'eyelet') h.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      else if (h.type === 'zipper') {
        // бегунок: плашмя на ткани, язычок свисает вниз от замка
        zy.set(0, -1, 0).addScaledVector(n, n.y); if (zy.lengthSq() < 1e-4) zy.set(1, 0, 0); zy.normalize();
        zx.crossVectors(zy, n).normalize();
        zm.makeBasis(zx, zy, n); h.mesh.quaternion.setFromRotationMatrix(zm);
        h.mesh.position.addScaledVector(zy, 0.9 * (h.s || 0.85));
      } else h.mesh.quaternion.setFromUnitVectors(up, n);
    }
  }
  setAccessories(groups) {
    for (const c of [...this.accGroup.children]) this.accGroup.remove(c);
    for (const g of groups) this.accGroup.add(g);
  }
  _bindPointer() {
    const el = this.renderer.domElement;
    const toNDC = (e) => { const r = el.getBoundingClientRect(); this.ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
    let down = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      toNDC(e);
      this.ray.setFromCamera(this.ptr, this.camera);
      for (const { mesh } of this.meshes.values()) mesh.geometry.computeBoundingSphere();
      const hit = this.ray.intersectObjects([...this.meshes.values()].map((m) => m.mesh), false)[0];
      down = { x: e.clientX, y: e.clientY, hit };
      if (hit && this.app.onClothDown(hit, e)) {
        this.controls.enabled = false;
        el.setPointerCapture(e.pointerId);
        down.capture = true;
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!down?.capture) return;
      toNDC(e);
      this.ray.setFromCamera(this.ptr, this.camera);
      this.app.onClothMove(this.ray, e);
    });
    el.addEventListener('pointerup', (e) => {
      if (down?.capture) { this.app.onClothUp(e); this.controls.enabled = true; }
      else if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) this.app.onClick3D(down.hit);
      down = null;
    });
  }
  snapshotPNG() { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/png'); }
  frameBody(body) {
    const H = body.m.height;
    this.controls.target.set(0, H * 0.55, 0);
    this.camera.position.set(H * 0.85, H * 0.75, H * 1.9);
  }
}

export function locateTri(mesh, px, py) {
  const { v2, tris } = mesh;
  let best = null, bestD = Infinity;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const ax = v2[2 * a], ay = v2[2 * a + 1], bx = v2[2 * b], by = v2[2 * b + 1], cx = v2[2 * c], cy = v2[2 * c + 1];
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-12) continue;
    const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den, l3 = 1 - l1 - l2;
    const out = Math.max(0, -l1) + Math.max(0, -l2) + Math.max(0, -l3);
    if (out < bestD) { bestD = out; best = { tri: [a, b, c], w: [l1, l2, l3] }; }
    if (out === 0) break;
  }
  return bestD < 0.5 ? best : null;
}
