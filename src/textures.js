// @ts-check
// Per-piece texture canvas: fabric + overlays (colour blocks / patches) + prints + brush strokes + stitching, all in pattern space
import { bbox, shade, rng } from './util.js';
import { paintFabric } from './materials.js';
import { edgePts } from './patterns.js';

const imgCache = {};
export function getImage(images, id, onload) {
  if (!id || !images[id]) return null;
  if (imgCache[id]) return imgCache[id].complete ? imgCache[id] : null;
  const im = new Image();
  im.onload = () => onload && onload();
  im.src = images[id];
  imgCache[id] = im;
  return null;
}

export function pieceCanvas(piece, matsById, images, onImg, maxPx = 1024) {
  const bx = bbox(piece.pts);
  const pad = 3;
  const x0 = bx.x0 - pad, y1 = bx.y1 + pad, w = bx.w + 2 * pad, h = bx.h + 2 * pad;
  const ppcm = Math.max(2.5, Math.min(9, maxPx / Math.max(w, h)));
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(w * ppcm); cv.height = Math.ceil(h * ppcm);
  const ctx = cv.getContext('2d');
  ctx.setTransform(ppcm, 0, 0, -ppcm, -x0 * ppcm, y1 * ppcm); // pattern cm, y up
  const mat = matsById[piece.mat] || Object.values(matsById)[0];
  const seed = [...piece.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  paintFabric(ctx, mat, { x0: x0, y0: bx.y0 - pad, x1: x0 + w, y1, w, h }, seed);
  drawDecor(ctx, piece, matsById, images, onImg);
  return { canvas: cv, x0, y0: bx.y0 - pad, w, h, ppcm };
}

export function drawDecor(ctx, piece, matsById, images, onImg) {
  // overlays (layers on top of the piece)
  for (const o of piece.overlays || []) {
    if (o.hidden) continue;
    const m = matsById[o.mat] || matsById[piece.mat];
    ctx.save();
    path(ctx, o.pts); ctx.clip();
    const ob = bbox(o.pts);
    paintFabric(ctx, m, { ...ob, x0: ob.x0 - 1, y0: ob.y0 - 1, w: ob.w + 2, h: ob.h + 2 }, o.id.length * 31);
    ctx.restore();
    // edge + topstitch
    ctx.save();
    path(ctx, o.pts);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 0.18; ctx.stroke();
    ctx.setLineDash([0.35, 0.25]); ctx.strokeStyle = shade(m.color, m.color < '#555555' ? 0.45 : -0.45); ctx.lineWidth = 0.07;
    path(ctx, inset(o.pts, 0.4)); ctx.stroke();
    ctx.restore();
  }
  // brush strokes
  for (const s of piece.strokes || []) {
    if (s.pts.length < 2) continue;
    ctx.save();
    ctx.globalAlpha = s.alpha ?? 1;
    ctx.strokeStyle = s.color; ctx.lineWidth = s.w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (s.mode === 'bleach') { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.25; }
    ctx.beginPath(); ctx.moveTo(s.pts[0][0], s.pts[0][1]);
    for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i][0], s.pts[i][1]);
    ctx.stroke();
    ctx.restore();
  }
  // prints
  for (const p of piece.prints || []) {
    const im = getImage(images, p.img, onImg);
    if (!im) continue;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(((p.rot || 0) * Math.PI) / 180);
    ctx.scale(1, -1);
    ctx.globalAlpha = p.opacity ?? 1;
    if (p.blend) ctx.globalCompositeOperation = p.blend;
    const w = p.w, h = (p.w * im.height) / im.width;
    ctx.drawImage(im, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  // stitching & raw edges
  const mat = matsById[piece.mat] || Object.values(matsById)[0];
  const thread = mat && mat.color < '#666666' ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.3)';
  for (let k = 0; k < piece.corners.length; k++) {
    const m = piece.meta[piece.corners[k].id] || {};
    const e = edgePts(piece, k);
    if (m.raw) {
      const r = rng(k * 13 + 7);
      ctx.save(); ctx.strokeStyle = shade(mat.color, 0.3); ctx.lineWidth = 0.06; ctx.globalAlpha = 0.7;
      for (let i = 1; i < e.length; i++) {
        const a = e[i - 1], b = e[i], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        const nx = -dy / l, ny = dx / l;
        for (let t = 0; t < 1; t += 0.12) { const px = a[0] + dx * t, py = a[1] + dy * t, L = 0.2 + r() * 0.5; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + nx * L, py + ny * L); ctx.stroke(); }
      }
      ctx.restore();
    } else if (m.name === 'низ' || m.name === 'низ рукава' || m.name === 'борт' || m.name === 'пояс') {
      const d = Math.max(0.6, Math.min(2.5, (m.sa || 1) - 0.6));
      ctx.save(); ctx.strokeStyle = thread; ctx.lineWidth = 0.06; ctx.setLineDash([0.3, 0.2]);
      ctx.beginPath();
      for (let i = 0; i < e.length; i++) {
        const a = e[Math.max(0, i - 1)], b = e[Math.min(e.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        const px = e[i][0] - (dy / l) * d, py = e[i][1] + (dx / l) * d;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
      if (m.name === 'низ' || m.name === 'низ рукава') {
        ctx.beginPath();
        for (let i = 0; i < e.length; i++) {
          const a = e[Math.max(0, i - 1)], b = e[Math.min(e.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
          const px = e[i][0] - (dy / l) * (d + 0.6), py = e[i][1] + (dx / l) * (d + 0.6);
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

export function path(ctx, pts) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
}
function inset(pts, d) {
  // crude inward offset (works for CCW and CW by testing centroid side)
  let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= pts.length; cy /= pts.length;
  return pts.map((p) => { const dx = cx - p[0], dy = cy - p[1], l = Math.hypot(dx, dy) || 1; return [p[0] + (dx / l) * d, p[1] + (dy / l) * d]; });
}
