const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERR: ' + e.message + ' ' + (e.stack||'').slice(0,400)));
  await page.goto('file://' + process.cwd() + '/dist/index.html');
  await page.waitForTimeout(2500);
  // select tee garment, show grading veer, set tirage
  await page.evaluate(() => { const a = window.__app; const g = a.S.garments.find(g => g.gen === 'top'); a.select({ g: g.id }); });
  await page.waitForTimeout(500);
  await page.evaluate(() => { const a = window.__app; const g = a.S.garments.find(g => g.gen === 'top'); const p = g.pieces[0]; const ed = a.editor; let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9; for (const q of g.pieces) for (const [x,y] of q.pts){x0=Math.min(x0,x+q.view.x);x1=Math.max(x1,x+q.view.x);y0=Math.min(y0,y+q.view.y);y1=Math.max(y1,y+q.view.y);} ed.v.cx=(x0+x1)/2; ed.v.cy=(y0+y1)/2; ed.v.s=Math.min(ed.W/(x1-x0+20), ed.H/(y1-y0+20)); ed.dirty=true; });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test/g1.png' });
  // tirage S1 M2 L1 for both garments
  const lay = await page.evaluate(async () => { const a = window.__app; for (const g of a.S.garments) g.grading.qty = { S: 1, M: 2, L: 1 }; a.changed({ grade: true }); await new Promise(r => setTimeout(r, 2500)); return (a.layout||[]).map(r => r.mat.name + ': ' + r.placed.length + ' дет, ' + (r.length/100).toFixed(2) + ' м, ' + (r.util*100).toFixed(0) + '%'); });
  console.log('tirage', JSON.stringify(lay));
  // export: capture saves
  const res = await page.evaluate(async () => {
    const a = window.__app; const out = [];
    a.save = async (n, d) => { const buf = d instanceof Blob ? new Uint8Array(await d.arrayBuffer()) : new TextEncoder().encode(d); out.push({ n, size: buf.length, head: Array.from(buf.slice(0, 8)).map(c=>String.fromCharCode(c)).join(''), b64: (() => { let s = ''; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode.apply(null, buf.subarray(i, i + 8192)); return btoa(s); })() }); };
    document.querySelector('[data-x=prod]').click();
    await new Promise(r => setTimeout(r, 300));
    document.querySelector('#xGo').click();
    await new Promise(r => setTimeout(r, 6000));
    document.querySelector('[data-x=prod]').click();
    await new Promise(r => setTimeout(r, 300));
    document.querySelector('input[name=fmt][value=dxf]').checked = true;
    document.querySelectorAll('[data-xs]').forEach(i => i.checked = true);
    document.querySelector('#xGo').click();
    await new Promise(r => setTimeout(r, 1500));
    document.querySelector('[data-x=prod]').click();
    await new Promise(r => setTimeout(r, 300));
    document.querySelector('input[name=fmt][value=svg]').checked = true;
    document.querySelectorAll('[data-xs]').forEach(i => i.checked = true);
    document.querySelector('#xGo').click();
    await new Promise(r => setTimeout(r, 1500));
    return out;
  });
  for (const r of res) { console.log(r.n, r.size, JSON.stringify(r.head)); if (r.b64) fs.writeFileSync('test/out_' + r.n.replace(/[^a-z0-9.\-]/gi, '_'), Buffer.from(r.b64, 'base64')); }
  console.log(errs.join('\n'));
  await browser.close();
})();
