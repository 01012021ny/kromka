// @ts-check
// Main-thread facade with the same surface as Sim; the solver itself runs in a Web Worker
import { Sim } from './sim.js';
import { findPiece } from './patterns.js';

export class SimProxy {
  constructor(body, src, getGarments) {
    this.body = body; this.getGarments = getGarments;
    this.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    this.N = 0; this.x = new Float32Array(0); this.nrm = new Float32Array(0); this.outward = new Float32Array(0);
    this.pieces = []; this.belts = []; this.energy = 0; this.t = 0; this.settled = false; this._running = true; this._grab = null;
    this.seq = 0; this.pending = null; this.onBuilt = null; this.stepMs = 0; this.isWorker = true;
    this.worker.onmessage = (e) => this._msg(e.data);
    this.worker.onerror = (e) => { console.error('sim worker', e.message); };
  }
  _msg(m) {
    if (m.seq !== this.seq) return;
    if (m.type === 'built') {
      const gs = this.getGarments();
      this.N = m.N;
      this.x = new Float32Array(m.x);
      this.nrm = new Float32Array(this.N * 3); this.outward = new Float32Array(this.N * 3);
      this.st = m.st; this.stR = m.stR;
      this.pieces = [];
      for (const pm of m.pieces) {
        const f = findPiece(gs, pm.pid);
        if (!f) continue;
        this.pieces.push({ piece: f.p, garment: f.g, off: pm.off, n: pm.n, layer: pm.layer, mesh: { v2: pm.v2, tris: pm.tris, nb: pm.nb } });
      }
      this.settled = false; this.t = 0;
      this.onBuilt && this.onBuilt(this);
    } else if (m.type === 'x') {
      this.pending = m.x; this.energy = m.energy; this.settled = m.settled; this.t = m.t; this.stepMs = m.ms;
    } else if (m.type === 'state') {
      this.settled = m.settled; this.energy = m.energy;
    }
  }
  build(garments, matsById, h, prev) {
    this.seq++;
    this.worker.postMessage({ type: 'build', seq: this.seq, garments: JSON.parse(JSON.stringify(garments)), mats: matsById, h, fresh: !prev, body: this._bodyMsg() });
    return this;
  }
  _bodyMsg() { return { params: this.bodyParams, caps: this.body.extraCaps, belts: this.belts }; }
  syncBody(params) { this.bodyParams = JSON.parse(JSON.stringify(params)); this.worker.postMessage({ type: 'body', ...this._bodyMsg() }); }
  snapshot() { return {}; }
  step() { if (this.pending && this.pending.length === this.x.length) { this.x.set(this.pending); this.pending = null; return true; } this.pending = null; return false; }
  wake() { this.settled = false; this.worker.postMessage({ type: 'wake' }); }
  get running() { return this._running; }
  set running(v) { this._running = v; this.worker.postMessage({ type: 'run', on: v }); }
  get grab() { return this._grab; }
  set grab(g) { this._grab = g; this.worker.postMessage({ type: 'grab', grab: g }); }
  set selfCollide(v) { this.worker.postMessage({ type: 'self', on: v }); }
  computeNormals() { return Sim.prototype.computeNormals.call(this); }
  strainColors(out) { return Sim.prototype.strainColors.call(this, out); }
  pick(i) { return Sim.prototype.pick.call(this, i); }
}
