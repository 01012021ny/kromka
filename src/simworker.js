// @ts-check
// Web Worker: runs the cloth solver off the main thread
import { Body } from './body.js';
import { Sim } from './sim.js';

const body = new Body(null);
const sim = new Sim(body);
let timer = null, seq = 0;

function setBody(m) {
  body.build(m.params, { noGrid: true });
  body.extraCaps = m.caps || [];
  body.buildGrid();
  sim.belts = m.belts || [];
}
function post(type, extra = {}, transfer = []) { /** @type {(m: any, t: Transferable[]) => void} */ (postMessage)({ type, seq, ...extra }, transfer); }
function loop() {
  timer = null;
  if (!sim.N || !sim.running || sim.settled) { post('state', { running: sim.running, settled: sim.settled, energy: sim.energy, t: sim.t }); return; }
  const t0 = performance.now();
  sim.step(1 / 60);
  sim.computeNormals();
  const x = sim.x.slice();
  post('x', { x, energy: sim.energy, settled: sim.settled, t: sim.t, running: sim.running, ms: performance.now() - t0 }, [x.buffer]);
  timer = setTimeout(loop, Math.max(0, 15 - (performance.now() - t0)));
}
const kick = () => { if (!timer) timer = setTimeout(loop, 0); };

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'body') { setBody(m); sim.wake(); kick(); }
  else if (m.type === 'build') {
    if (m.body) setBody(m.body);
    const prev = m.fresh || !sim.N ? null : sim.snapshot();
    sim.build(m.garments, m.mats, m.h, prev);
    seq = m.seq;
    sim.computeNormals();
    post('built', {
      N: sim.N, x: sim.x.slice(), st: sim.st, stR: sim.stR,
      pieces: sim.pieces.map((r) => ({ pid: r.piece.id, gid: r.garment.id, off: r.off, n: r.n, layer: r.layer, v2: r.mesh.v2, tris: r.mesh.tris, nb: r.mesh.nb })),
      running: sim.running,
    });
    kick();
  } else if (m.type === 'grab') { sim.grab = m.grab; sim.wake(); kick(); }
  else if (m.type === 'run') { sim.running = m.on; if (m.on) sim.wake(); kick(); }
  else if (m.type === 'wake') { sim.wake(); kick(); }
  else if (m.type === 'self') { sim.selfCollide = m.on; }
  else if (m.type === 'fit') { sim.holdFit = m.on; sim.wake(); kick(); }
};
