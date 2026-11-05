// @ts-check
// 2D pattern editor: pan/zoom, select/drag corners & bends, cut (curve / freehand), overlays (layers), brush, prints, hardware, seams
import { dist, polyDist, inside, centroid, bbox, catmull, simplify, fmt, uid, area, polyLen } from './util.js';
import { edgePts, edgeIdx, cutOutline, deformCorner, deformEdge, mirrorCorner, mirrorEdgeK, splitEdge, removeCorner, cutPiece, seamOf, seamLengths, seamTol, edgeK, edgeMeta } from './patterns.js';
import { path } from './textures.js';
import { sizesOf, SIZES } from './grading.js';

const SEAM_COLORS = ['#c9b37e', '#7ea6c9', '#b07ec9', '#7ec9b9', '#c98f7e', '#9fc97e', '#c97ea8', '#7e86c9', '#c9c27e', '#7ec98a', '#a57ec9', '#c9a07e'];
export const POS = '#5fae6e', NEG = '#d4473b';

export class Editor2D {
  constructor(canvas, app) {
    this.cv = canvas; this.app = app;
    this.ctx = canvas.getContext('2d');
    this.v = { cx: 40, cy: 100, s: 3 };
    this.drag = null; this.tmp = null; this.hover = null;
    this.dirty = true;
    this._bind();
    new ResizeObserver(() => { this.resize(); }).observe(canvas.parentElement);
    this.resize();
    const loop = () => { if (this.dirty) { this.dirty = false; this.render(); } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  resize() {
    const p = this.cv.parentElement, dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = p.clientWidth; this.H = p.clientHeight;
    this.cv.width = this.W * dpr; this.cv.height = this.H * dpr;
    this.cv.style.width = this.W + 'px'; this.cv.style.height = this.H + 'px';
    this.dpr = dpr; this.dirty = true;
  }
  toW(sx, sy) { return [(sx - this.W / 2) / this.v.s + this.v.cx, -(sy - this.H / 2) / this.v.s + this.v.cy]; }
  toS(x, y) { return [(x - this.v.cx) * this.v.s + this.W / 2, -(y - this.v.cy) * this.v.s + this.H / 2]; }
  fit() {
    const all = [];
    for (const g of this.app.S.garments) if (g.visible !== false) for (const p of g.pieces) for (const q of p.pts) all.push([q[0] + p.view.x, q[1] + p.view.y]);
    if (!all.length) return;
    const b = bbox(all);
    this.v.cx = (b.x0 + b.x1) / 2; this.v.cy = (b.y0 + b.y1) / 2;
    this.v.s = Math.min((this.W - 60) / Math.max(10, b.w), (this.H - 60) / Math.max(10, b.h));
    this.dirty = true;
  }
  pieces() {
    const out = [];
    for (const g of this.app.S.garments) if (g.visible !== false) for (const p of g.pieces) if (!p.hidden) out.push({ g, p });
    return out;
  }
  local(p, w) { return [w[0] - p.view.x, w[1] - p.view.y]; }
  hitPiece(w) {
    const ps = this.pieces();
    for (let i = ps.length - 1; i >= 0; i--) { const { p } = ps[i]; if (inside(this.local(p, w), p.pts)) return ps[i]; }
    return null;
  }
  hitEdge(w, onlyPiece) {
    const tol = 7 / this.v.s;
    let best = null;
    for (const { g, p } of this.pieces()) {
      if (onlyPiece && p !== onlyPiece) continue;
      const l = this.local(p, w);
      for (let k = 0; k < p.corners.length; k++) {
        const e = edgePts(p, k);
        const r = polyDist(l, e, false);
        if (r.d < tol && (!best || r.d < best.d)) {
          let acc = 0; for (let j = 0; j < r.seg; j++) acc += dist(e[j], e[j + 1]); acc += dist(e[r.seg], e[r.seg + 1]) * r.t;
          best = { g, p, k, d: r.d, f: acc / polyLen(e) };
        }
      }
    }
    return best;
  }
  hitCorner(w, p) {
    const tol = 8 / this.v.s, l = this.local(p, w);
    for (let k = 0; k < p.corners.length; k++) if (dist(l, p.pts[p.corners[k].i]) < tol) return k;
    return -1;
  }
  hitBend(w, p) {
    const tol = 7 / this.v.s, l = this.local(p, w);
    for (let k = 0; k < p.corners.length; k++) { const e = edgePts(p, k); if (e.length < 3) continue; if (dist(l, e[Math.floor(e.length / 2)]) < tol) return k; }
    return -1;
  }
  _bind() {
    const cv = this.cv;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      const sel = this.app.selPrint();
      if (sel && (e.altKey || this.app.tool === 'print')) { this.app.scalePrint(sel, e.deltaY < 0 ? 1.05 : 1 / 1.05); return; }
      const before = this.toW(sx, sy);
      this.v.s *= Math.exp(-e.deltaY * 0.0015);
      this.v.s = Math.max(0.4, Math.min(60, this.v.s));
      const after = this.toW(sx, sy);
      this.v.cx += before[0] - after[0]; this.v.cy += before[1] - after[1];
      this.dirty = true;
    }, { passive: false });
    // iPad / сенсор: два пальца — масштаб и сдвиг; одиночное касание и Apple Pencil работают как мышь
    this.touches = new Map(); this.pinch = null;
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', (e) => { if (!this.touchDown(e)) this.down(e); });
    cv.addEventListener('pointermove', (e) => { if (!this.touchMove(e)) this.move(e); });
    cv.addEventListener('pointerup', (e) => { if (!this.touchUp(e)) this.up(e); });
    cv.addEventListener('pointercancel', (e) => { this.touchUp(e); this.abortGesture(); });
    cv.addEventListener('dblclick', (e) => { if (this.app.tool === 'cut' && this.tmp?.ctrl?.length >= 2) this.finishCut(); });
    window.addEventListener('keydown', (e) => {
      const t = /** @type {Element} */ (e.target);
      if (t.closest && t.closest('input,textarea,select')) return;
      if (e.key === 'Enter' && this.app.tool === 'cut') this.finishCut();
      if (e.key === 'Escape') { this.tmp = null; this.dirty = true; }
    });
  }
  touchDown(e) {
    if (e.pointerType !== 'touch') return false;
    const { sx, sy } = this.ev(e);
    this.touches.set(e.pointerId, [sx, sy]);
    if (this.touches.size === 2) {
      this.abortGesture();
      const [a, b] = [...this.touches.values()];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      this.pinch = { d0: Math.max(10, Math.hypot(a[0] - b[0], a[1] - b[1])), s0: this.v.s, w0: this.toW(mid[0], mid[1]) };
      return true;
    }
    return this.touches.size > 2 || !!this.pinch;
  }
  touchMove(e) {
    if (e.pointerType !== 'touch' || !this.touches.has(e.pointerId)) return false;
    const { sx, sy } = this.ev(e);
    this.touches.set(e.pointerId, [sx, sy]);
    if (!this.pinch || this.touches.size < 2) return !!this.pinch;
    const [a, b] = [...this.touches.values()];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const s = Math.max(0.4, Math.min(60, (this.pinch.s0 * d) / this.pinch.d0));
    this.v.s = s;
    this.v.cx = this.pinch.w0[0] - (mid[0] - this.W / 2) / s;
    this.v.cy = this.pinch.w0[1] + (mid[1] - this.H / 2) / s;
    this.dirty = true;
    return true;
  }
  touchUp(e) {
    if (e.pointerType !== 'touch') return false;
    const was = !!this.pinch;
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinch = null;
    return was || this.touches.size > 0;
  }
  // отменить начатое действие (второй палец превратил жест в масштаб)
  abortGesture() {
    const d = this.drag;
    if (d && (d.type === 'corner' || d.type === 'bend')) { d.p.pts = d.base; this.app.undo(true); }
    else if (d && d.type === 'movePiece' && d.committed) { d.p.view.x = d.vx; d.p.view.y = d.vy; this.app.undo(true); }
    else if (d && d.type === 'print') { d.pr.x = d.x0; d.pr.y = d.y0; this.app.undo(true); }
    this.drag = null; this.tmp = null; this.dirty = true;
  }
  ev(e) { const r = this.cv.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top; return { sx, sy, w: this.toW(sx, sy) }; }
  down(e) {
    const { sx, sy, w } = this.ev(e);
    this.cv.setPointerCapture(e.pointerId);
    const app = this.app, tool = app.tool;
    if (e.button === 1 || e.button === 2 || tool === 'pan' || (e.button === 0 && app.spaceDown)) { this.drag = { type: 'pan', sx, sy, cx: this.v.cx, cy: this.v.cy }; return; }
    const selP = app.selPiece();
    if (tool === 'select') {
      if (selP) {
        const k = this.hitCorner(w, selP);
        if (k >= 0) {
          app.commit('Перемещение точки');
          const mk = selP.sym ? mirrorCorner(selP, k) : -1;
          this.drag = { type: 'corner', p: selP, k, mk, base: selP.pts.map((q) => [...q]), w0: w };
          return;
        }
        const b = this.hitBend(w, selP);
        if (b >= 0) {
          app.commit('Изгиб стороны');
          const mk = selP.sym ? mirrorEdgeK(selP, b) : -1;
          this.drag = { type: 'bend', p: selP, k: b, mk, base: selP.pts.map((q) => [...q]), w0: w };
          return;
        }
        // print drag
        const pr = this.hitPrint(w, selP);
        if (pr) { app.commit('Перемещение принта'); app.select({ p: selP.id, print: pr.id }); this.drag = { type: 'print', p: selP, pr, x0: pr.x, y0: pr.y, w0: w }; return; }
      }
      const he = this.hitEdge(w);
      if (he) { app.select({ g: he.g.id, p: he.p.id, edge: he.p.corners[he.k].id }); this.drag = { type: 'movePiece', p: he.p, vx: he.p.view.x, vy: he.p.view.y, w0: w, committed: false }; return; }
      const hp = this.hitPiece(w);
      if (hp) {
        const ov = (hp.p.overlays || []).slice().reverse().find((o) => inside(this.local(hp.p, w), o.pts));
        app.select({ g: hp.g.id, p: hp.p.id, overlay: ov?.id });
        this.drag = { type: 'movePiece', p: hp.p, vx: hp.p.view.x, vy: hp.p.view.y, w0: w, committed: false };
        return;
      }
      app.select({});
      this.drag = { type: 'pan', sx, sy, cx: this.v.cx, cy: this.v.cy };
      return;
    }
    if (tool === 'point') {
      if (selP && e.altKey) {
        const k = this.hitCorner(w, selP);
        if (k >= 0) { app.commit('Удаление точки'); const g = app.garmentOf(selP); if (!removeCorner(g, selP, k)) app.toast('Нельзя: у детали минимум 3 стороны', 'neg'); app.changed({ geo: true, tex: [selP.id] }); }
        return;
      }
      const he = this.hitEdge(w);
      if (he) { app.commit('Новая точка'); splitEdge(he.g, he.p, he.k, he.f); app.select({ g: he.g.id, p: he.p.id }); app.changed({ geo: true }); }
      return;
    }
    if (tool === 'cut') {
      if (!this.tmp || this.tmp.type !== 'cut') this.tmp = { type: 'cut', ctrl: [] };
      this.tmp.ctrl.push(w); this.dirty = true;
      return;
    }
    if (tool === 'cutfree' || tool === 'overlay' || tool === 'brush') {
      const hp = tool === 'cutfree' ? null : this.hitPiece(w);
      if (tool !== 'cutfree' && !hp) { app.toast('Начните внутри детали', 'neg'); return; }
      this.tmp = { type: tool, pts: [w], hp };
      return;
    }
    if (tool === 'print') {
      const hp = this.hitPiece(w);
      if (!hp) return;
      const pr = this.hitPrint(w, hp.p);
      if (pr) { app.commit('Перемещение принта'); app.select({ g: hp.g.id, p: hp.p.id, print: pr.id }); this.drag = { type: 'print', p: hp.p, pr, x0: pr.x, y0: pr.y, w0: w }; return; }
      app.placePrint(hp.g, hp.p, this.local(hp.p, w));
      return;
    }
    if (tool === 'hw') {
      const hp = this.hitPiece(w);
      if (!hp) return;
      app.commit('Фурнитура');
      const l = this.local(hp.p, w), o = app.toolOpts;
      hp.p.hardware.push({ id: uid('h'), type: o.hwType, x: l[0], y: l[1], size: o.hwSize, color: o.hwColor });
      app.select({ g: hp.g.id, p: hp.p.id });
      app.changed({ hw: true });
      return;
    }
    if (tool === 'seam') {
      const he = this.hitEdge(w);
      if (!he) return;
      const cid = he.p.corners[he.k].id;
      if (e.altKey) { const s = seamOf(he.g, he.p.id, cid); if (s) { app.commit('Удалить шов'); he.g.seams = he.g.seams.filter((x) => x !== s); app.changed({ geo: true }); } return; }
      if (!this.tmp || this.tmp.type !== 'seam') { this.tmp = { type: 'seam', a: { g: he.g, p: he.p, e: cid } }; this.dirty = true; app.toast('Теперь выберите вторую сторону'); return; }
      const a = this.tmp.a;
      this.tmp = null;
      if (a.g !== he.g) { app.toast('Шов можно создать только внутри одного изделия', 'neg'); return; }
      if (a.p === he.p && a.e === cid) return;
      app.addSeam(a.g, { p: a.p.id, e: a.e }, { p: he.p.id, e: cid });
      return;
    }
  }
  move(e) {
    const { sx, sy, w } = this.ev(e);
    this.mouse = w;
    const d = this.drag;
    if (d) {
      if (d.type === 'pan') { this.v.cx = d.cx - (sx - d.sx) / this.v.s; this.v.cy = d.cy + (sy - d.sy) / this.v.s; this.dirty = true; return; }
      const dx = w[0] - (d.w0?.[0] ?? 0), dy = w[1] - (d.w0?.[1] ?? 0);
      if (d.type === 'corner') {
        let pts = deformCorner(d.base, d.p, d.k, dx, dy);
        if (d.mk >= 0) pts = deformCorner(pts, d.p, d.mk, -dx, dy);
        d.p.pts = pts; this.dirty = true; this.app.live();
        return;
      }
      if (d.type === 'bend') {
        let pts = deformEdge(d.base, d.p, d.k, dx, dy);
        if (d.mk >= 0) pts = deformEdge(pts, d.p, d.mk, -dx, dy);
        d.p.pts = pts; this.dirty = true; this.app.live();
        return;
      }
      if (d.type === 'movePiece') {
        if (!d.committed && Math.hypot(dx, dy) * this.v.s > 3) { this.app.commit('Перемещение детали'); d.committed = true; }
        if (d.committed) { d.p.view.x = d.vx + dx; d.p.view.y = d.vy + dy; this.dirty = true; }
        return;
      }
      if (d.type === 'print') { d.pr.x = d.x0 + dx; d.pr.y = d.y0 + dy; this.dirty = true; this.app.liveTex(d.p); return; }
    }
    if (this.tmp && (this.tmp.type === 'cutfree' || this.tmp.type === 'overlay' || this.tmp.type === 'brush')) {
      const last = this.tmp.pts[this.tmp.pts.length - 1];
      if (dist(last, w) * this.v.s > 2.5) {
        this.tmp.pts.push(w); this.dirty = true;
        if (this.tmp.type === 'brush') this.app.brushLive(this.tmp);
      }
      return;
    }
    // hover feedback
    const prev = this.hover;
    this.hover = this.hitEdge(w);
    if (prev?.p !== this.hover?.p || prev?.k !== this.hover?.k) this.dirty = true;
    if (this.app.tool === 'cut' && this.tmp) this.dirty = true;
  }
  up(e) {
    const d = this.drag; this.drag = null;
    if (d) {
      if (d.type === 'corner' || d.type === 'bend') this.app.changed({ geo: true, tex: [d.p.id] });
      if (d.type === 'movePiece' && d.committed) this.app.changed({ view: true });
      if (d.type === 'print') this.app.changed({ tex: [d.p.id] });
      return;
    }
    const t = this.tmp;
    if (!t) return;
    if (t.type === 'cutfree') {
      this.tmp = null;
      const pts = simplify(t.pts, 0.25);
      this.doCut(pts);
      return;
    }
    if (t.type === 'overlay') {
      this.tmp = null;
      const loc = simplify(t.pts.map((q) => this.local(t.hp.p, q)), 0.2);
      if (loc.length < 3 || Math.abs(area(loc)) < 4) { this.app.toast('Обведите область побольше', 'neg'); this.dirty = true; return; }
      this.app.addOverlay(t.hp.g, t.hp.p, loc);
      return;
    }
    if (t.type === 'brush') {
      this.tmp = null;
      this.app.addStroke(t.hp.g, t.hp.p, t.pts.map((q) => this.local(t.hp.p, q)));
      return;
    }
  }
  finishCut() {
    const t = this.tmp;
    if (!t || t.ctrl.length < 2) return;
    this.tmp = null;
    const pts = t.ctrl.length > 2 ? catmull(t.ctrl, 10) : t.ctrl;
    this.doCut(pts);
  }
  doCut(worldPts) {
    // find a piece crossed by the path
    for (const { g, p } of this.pieces().reverse()) {
      const loc = worldPts.map((q) => this.local(p, q));
      let crosses = 0;
      for (let i = 0; i < loc.length - 1; i++) if (inside(loc[i], p.pts) !== inside(loc[i + 1], p.pts)) crosses++;
      if (crosses < 2) continue;
      this.app.commit('Разрез детали');
      const r = cutPiece(g, p, loc);
      if (r.error) { this.app.undo(true); this.app.toast(r.error, 'neg'); return; }
      r.B.view = { x: p.view.x, y: p.view.y };
      this.app.select({ g: g.id, p: r.B.id });
      this.app.changed({ geo: true, tex: [r.A.id, r.B.id] });
      this.app.toast('Деталь разделена, шов членения добавлен автоматически', 'pos');
      return;
    }
    this.app.toast('Линия должна пересечь деталь от края до края', 'neg');
    this.dirty = true;
  }
  hitPrint(w, p) {
    const l = this.local(p, w);
    for (const pr of (p.prints || []).slice().reverse()) {
      const im = this.app.imageSize(pr.img);
      const hw = pr.w / 2, hh = (pr.w * im) / 2;
      const a = (-(pr.rot || 0) * Math.PI) / 180, dx = l[0] - pr.x, dy = l[1] - pr.y;
      const rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(rx) <= hw && Math.abs(ry) <= hh) return pr;
    }
    return null;
  }
  // ───────── rendering ─────────
  render() {
    const c = this.ctx, app = this.app, S = app.S, s = this.v.s;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#0f0f10'; c.fillRect(0, 0, this.W, this.H);
    // grid
    const [wx0, wy1] = this.toW(0, 0), [wx1, wy0] = this.toW(this.W, this.H);
    const step = s > 6 ? 1 : s > 1.5 ? 5 : 10;
    c.lineWidth = 1;
    for (let x = Math.floor(wx0 / step) * step; x <= wx1; x += step) { const [px] = this.toS(x, 0); c.strokeStyle = x % 50 === 0 ? '#25252a' : x % 10 === 0 ? '#1c1c20' : '#151518'; c.beginPath(); c.moveTo(px + 0.5, 0); c.lineTo(px + 0.5, this.H); c.stroke(); }
    for (let y = Math.floor(wy0 / step) * step; y <= wy1; y += step) { const [, py] = this.toS(0, y); c.strokeStyle = y % 50 === 0 ? '#25252a' : y % 10 === 0 ? '#1c1c20' : '#151518'; c.beginPath(); c.moveTo(0, py + 0.5); c.lineTo(this.W, py + 0.5); c.stroke(); }
    // world transform
    c.save();
    c.translate(this.W / 2, this.H / 2); c.scale(s, -s); c.translate(-this.v.cx, -this.v.cy);
    const px = 1 / s;
    const seamIdx = new Map();
    let si = 0;
    for (const g of S.garments) for (const sm of g.seams) seamIdx.set(sm, si++);
    const selP = app.selPiece();
    for (const { g, p } of this.pieces()) {
      c.save(); c.translate(p.view.x, p.view.y);
      const isSel = p === selP;
      // cut line (with seam allowance)
      if (S.settings.showSA) {
        const co = cutOutline(p);
        path(c, co);
        c.fillStyle = 'rgba(255,255,255,0.025)'; c.fill();
        c.setLineDash([5 * px, 3 * px]); c.strokeStyle = '#6d6961'; c.lineWidth = px; c.stroke(); c.setLineDash([]);
      }
      // fabric texture
      const tex = app.view3d.texCache.get(p.id);
      c.save(); path(c, p.pts); c.clip();
      if (tex) { c.save(); c.translate(tex.x0, tex.y0 + tex.h); c.scale(1 / tex.ppcm, -1 / tex.ppcm); c.globalAlpha = 0.92; c.drawImage(tex.canvas, 0, 0); c.restore(); }
      else { c.fillStyle = app.matsById()[p.mat]?.color || '#555'; c.fill(); }
      c.restore();
      // overlays outline
      for (const o of p.overlays || []) {
        const sel = app.sel.overlay === o.id;
        path(c, o.pts); c.strokeStyle = sel ? '#f0ebe0' : 'rgba(240,235,224,0.45)'; c.lineWidth = (sel ? 2 : 1) * px; c.setLineDash(sel ? [] : [3 * px, 2 * px]); c.stroke(); c.setLineDash([]);
      }
      // sewing line
      path(c, p.pts);
      c.strokeStyle = isSel ? '#f2ede2' : '#bdb7ab'; c.lineWidth = (isSel ? 2 : 1.2) * px; c.stroke();
      // edges: seams, lengths
      for (let k = 0; k < p.corners.length; k++) {
        const e = edgePts(p, k), cid = p.corners[k].id, m = p.meta[cid] || {};
        const sm = seamOf(g, p.id, cid);
        const mid = e[Math.floor(e.length / 2)];
        const a = e[Math.max(0, Math.floor(e.length / 2) - 1)], b = e[Math.min(e.length - 1, Math.floor(e.length / 2) + 1)];
        let nx = b[1] - a[1], ny = -(b[0] - a[0]); const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        const hl = (this.hover && this.hover.p === p && this.hover.k === k) || (app.sel.edge === cid && isSel) || (this.tmp?.type === 'seam' && this.tmp.a.p === p && this.tmp.a.e === cid);
        if (sm || hl || m.raw || m.gather < 1) {
          c.beginPath(); e.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])));
          c.strokeStyle = hl ? '#ffffff' : m.raw ? '#8a8378' : sm ? SEAM_COLORS[seamIdx.get(sm) % SEAM_COLORS.length] : '#bdb7ab';
          c.lineWidth = (hl ? 3 : 2) * px;
          if (m.gather < 1) c.setLineDash([2 * px, 2 * px]);
          c.stroke(); c.setLineDash([]);
        }
        if (sm) { // notch
          c.beginPath(); c.moveTo(mid[0] + nx * 0.2, mid[1] + ny * 0.2); c.lineTo(mid[0] + nx * 1.1, mid[1] + ny * 1.1);
          c.strokeStyle = SEAM_COLORS[seamIdx.get(sm) % SEAM_COLORS.length]; c.lineWidth = 2 * px; c.stroke();
        }
        if (S.settings.showLen && (s > 3.2 || (isSel && s > 1.2))) {
          const L = polyLen(e);
          let txt = fmt(L), col = '#a29d93';
          if (sm) {
            const sl = seamLengths(g, sm);
            const letter = String.fromCharCode(65 + (seamIdx.get(sm) % 26)) + (seamIdx.get(sm) >= 26 ? Math.floor(seamIdx.get(sm) / 26) : '');
            if (sl) {
              const diff = Math.abs(sl.diff);
              const ok = diff < seamTol(sm);
              txt = `${letter} ${fmt(L)} ${ok ? '✓' : 'Δ' + (sl.diff > 0 ? '+' : '') + fmt(sm.a.p === p.id && sm.a.e === cid ? sl.diff : -sl.diff)}`;
              col = ok ? POS : NEG;
            }
          }
          if (m.gather < 1) txt += ` · резинка ×${fmt(m.gather, 2)}`;
          if (m.raw) txt += ' · сырой край';
          const off = 2.2 + (m.raw ? 0 : m.sa || 0);
          this.label(c, mid[0] + nx * off, mid[1] + ny * off, txt, col, px, 10);
        }
      }
      // grain line
      const ct = centroid(p.pts), bx = bbox(p.pts);
      const gl = Math.min(bx.h, bx.w) * 0.35, ga = ((p.grain || 0) * Math.PI) / 180;
      const gx = Math.sin(ga) * gl, gy = Math.cos(ga) * gl;
      c.strokeStyle = 'rgba(240,235,224,0.55)'; c.lineWidth = px;
      c.beginPath(); c.moveTo(ct[0] - gx, ct[1] - gy - 4); c.lineTo(ct[0] + gx, ct[1] + gy - 4); c.stroke();
      for (const sg of [1, -1]) { const tx = ct[0] + sg * gx, ty = ct[1] + sg * gy - 4; c.beginPath(); c.moveTo(tx, ty); c.lineTo(tx - sg * (Math.sin(ga) * 1.6) + Math.cos(ga) * 0.8, ty - sg * Math.cos(ga) * 1.6 - Math.sin(ga) * 0.8); c.moveTo(tx, ty); c.lineTo(tx - sg * (Math.sin(ga) * 1.6) - Math.cos(ga) * 0.8, ty - sg * Math.cos(ga) * 1.6 + Math.sin(ga) * 0.8); c.stroke(); }
      if (s > 1.1 || isSel) {
        this.label(c, ct[0], ct[1] + 3, p.name, isSel ? '#f2ede2' : '#d8d3c8', px, 12, true);
        const mt = app.matsById()[p.mat];
        if (s > 2.4 || isSel) this.label(c, ct[0], ct[1] + 0, `${mt ? mt.name : ''} · ${fmt(Math.abs(area(p.pts)) / 100, 0)} дм²${p.grain ? ' · нить ' + p.grain + '°' : ''}`, '#8f8a80', px, 9);
      }
      // hardware
      for (const h of p.hardware || []) {
        c.beginPath(); c.arc(h.x, h.y, (h.size || 1.6) / 2, 0, Math.PI * 2);
        c.strokeStyle = '#e8e2d5'; c.lineWidth = 1.2 * px; c.stroke();
        if (h.type === 'button') { c.beginPath(); c.moveTo(h.x - 0.3, h.y); c.lineTo(h.x + 0.3, h.y); c.moveTo(h.x, h.y - 0.3); c.lineTo(h.x, h.y + 0.3); c.stroke(); }
        if (h.type === 'eyelet') { c.beginPath(); c.arc(h.x, h.y, (h.size || 1.6) / 4, 0, Math.PI * 2); c.stroke(); }
      }
      // prints bbox
      for (const pr of p.prints || []) {
        if (!(app.tool === 'print' || app.sel.print === pr.id)) continue;
        const r = this.app.imageSize(pr.img);
        c.save(); c.translate(pr.x, pr.y); c.rotate(((pr.rot || 0) * Math.PI) / 180);
        c.strokeStyle = app.sel.print === pr.id ? '#f2ede2' : 'rgba(242,237,226,0.4)'; c.lineWidth = px; c.setLineDash([4 * px, 3 * px]);
        c.strokeRect(-pr.w / 2, (-pr.w * r) / 2, pr.w, pr.w * r); c.setLineDash([]); c.restore();
      }
      // handles
      if (isSel && app.tool === 'select') {
        for (let k = 0; k < p.corners.length; k++) {
          const q = p.pts[p.corners[k].i];
          c.fillStyle = '#0f0f10'; c.strokeStyle = '#f2ede2'; c.lineWidth = 1.2 * px;
          c.fillRect(q[0] - 3.5 * px, q[1] - 3.5 * px, 7 * px, 7 * px); c.strokeRect(q[0] - 3.5 * px, q[1] - 3.5 * px, 7 * px, 7 * px);
          const e = edgePts(p, k);
          if (e.length >= 3) { const m = e[Math.floor(e.length / 2)]; c.beginPath(); c.arc(m[0], m[1], 3 * px, 0, Math.PI * 2); c.fillStyle = '#f2ede2'; c.fill(); }
        }
      }
      if (isSel && app.tool === 'point') for (const k of p.corners) { const q = p.pts[k.i]; c.beginPath(); c.arc(q[0], q[1], 3.5 * px, 0, Math.PI * 2); c.fillStyle = '#f2ede2'; c.fill(); }
      c.restore();
    }
    // size nest (grading) for the selected garment
    const gsel = app.sel.g ? app.garment(app.sel.g) : null;
    if (gsel && gsel.visible !== false && gsel.grading?.show) {
      const base = gsel.grading.base, bi = SIZES.indexOf(base);
      const szs = sizesOf(gsel), lo = szs[0], hi = szs[szs.length - 1];
      for (const sz of szs) {
        if (sz === base) continue;
        const k = SIZES.indexOf(sz) - bi;
        const graded = app.graded(gsel, sz);
        c.strokeStyle = `rgba(236,230,216,${Math.max(0.4, 0.9 - Math.abs(k) * 0.14)})`;
        c.lineWidth = 1.2 * px;
        c.setLineDash(k < 0 ? [4 * px, 3 * px] : []);
        for (const gp of graded) {
          const orig = gsel.pieces.find((q) => q.id === gp.id);
          if (!orig || orig.hidden) continue;
          c.save(); c.translate(orig.view.x, orig.view.y);
          path(c, gp.pts); c.stroke();
          if (s > 1.4 && (sz === lo || sz === hi)) { const q = gp.pts[gp.corners[Math.min(1, gp.corners.length - 1)].i]; this.label(c, q[0] + (k > 0 ? 1.2 : -1.2) * Math.sign(q[0] || 1), q[1], sz, '#c9c3b6', px, 9); }
          c.restore();
        }
        c.setLineDash([]);
      }
    }
    // tool previews
    const t = this.tmp;
    if (t && (t.type === 'cutfree' || t.type === 'overlay' || t.type === 'brush')) {
      c.beginPath(); t.pts.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])));
      if (t.type === 'overlay') c.closePath();
      const zipB = t.type === 'brush' && app.toolOpts.brushMode === 'zip';
      c.strokeStyle = zipB ? app.toolOpts.zipTape : t.type === 'brush' ? app.toolOpts.brushColor : '#f2ede2';
      c.lineWidth = zipB ? 2.6 : t.type === 'brush' ? app.toolOpts.brushW : 1.5 * px;
      c.lineCap = 'round';
      if (t.type !== 'brush') c.setLineDash([4 * px, 3 * px]);
      c.stroke(); c.setLineDash([]);
    }
    if (t && t.type === 'cut') {
      const pts = [...t.ctrl, ...(this.mouse ? [this.mouse] : [])];
      const sm = pts.length > 2 ? catmull(pts, 10) : pts;
      c.beginPath(); sm.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])));
      c.strokeStyle = '#f2ede2'; c.lineWidth = 1.5 * px; c.setLineDash([6 * px, 3 * px]); c.stroke(); c.setLineDash([]);
      for (const q of t.ctrl) { c.beginPath(); c.arc(q[0], q[1], 3 * px, 0, Math.PI * 2); c.fillStyle = '#f2ede2'; c.fill(); }
    }
    c.restore();
    // scale bar
    c.fillStyle = '#8f8a80'; c.font = '10px "JetBrains Mono", monospace';
    const bar = s * 10;
    c.fillRect(16, this.H - 18, bar, 2);
    c.fillText('10 см', 16, this.H - 24);
  }
  label(c, x, y, txt, col, px, size = 10, bold = false) {
    c.save(); c.translate(x, y); c.scale(px, -px);
    c.font = `${bold ? '600 ' : ''}${size}px "JetBrains Mono", ui-monospace, monospace`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const w = c.measureText(txt).width;
    c.fillStyle = 'rgba(12,12,13,0.78)'; c.fillRect(-w / 2 - 3, -size / 2 - 2, w + 6, size + 4);
    c.fillStyle = col; c.fillText(txt, 0, 0);
    c.restore();
  }
}
void edgeIdx; void edgeK; void edgeMeta;
