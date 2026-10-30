const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERR: ' + e.message + ' ' + (e.stack||'').slice(0,400)));
  await page.goto('file://' + process.cwd() + '/dist/index.html');
  await page.waitForTimeout(2500);
  const t = await page.evaluate(() => { const a = window.__app; const t0 = performance.now(); a.rebuildSim(); return performance.now() - t0; });
  console.log('rebuildSim ms', t.toFixed(0));
  // zoom 2D to the tee front piece
  const pos = await page.evaluate(() => {
    const a = window.__app, g = a.S.garments.find(g => g.gen === 'top'), p = g.pieces.find(p => p.name === 'Перед'), ed = a.editor;
    a.select({ g: g.id, p: p.id });
    let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9; for (const [x,y] of p.pts){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
    ed.v.cx = p.view.x + (x0+x1)/2; ed.v.cy = p.view.y + (y0+y1)/2; ed.v.s = Math.min(ed.W/(x1-x0+40), ed.H/(y1-y0+40)); ed.dirty = true;
    const r = ed.cv.getBoundingClientRect();
    // corner = hem right corner (index 1)
    const c = p.pts[p.corners[1].i];
    const [sx, sy] = ed.toS(c[0] + p.view.x, c[1] + p.view.y);
    // cut path across the piece at mid height
    const ym = (y0 + y1) / 2;
    const a1 = ed.toS(x0 - 5 + p.view.x, ym + 10 + p.view.y), a2 = ed.toS(x1 + 5 + p.view.x, ym - 10 + p.view.y);
    return { cx: r.left + sx, cy: r.top + sy, cut: [r.left + a1[0], r.top + a1[1], r.left + a2[0], r.top + a2[1]], n: p.pts.length };
  });
  await page.waitForTimeout(300);
  // drag corner outward
  await page.mouse.move(pos.cx, pos.cy); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(pos.cx + i * 6, pos.cy + i * 3); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.waitForTimeout(500);
  // freehand cut
  await page.keyboard.press('f');
  await page.mouse.move(pos.cut[0], pos.cut[1]); await page.mouse.down();
  for (let i = 1; i <= 30; i++) { await page.mouse.move(pos.cut[0] + (pos.cut[2]-pos.cut[0])*i/30, pos.cut[1] + (pos.cut[3]-pos.cut[1])*i/30 + Math.sin(i/4)*15); await page.waitForTimeout(10); }
  await page.mouse.up();
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => { const a = window.__app, g = a.S.garments.find(g => g.gen === 'top'); return { names: g.pieces.map(p => p.name), seams: g.seams.length, hist: a.history.map(h=>h.label) }; });
  console.log(JSON.stringify(after));
  await page.keyboard.press('v');
  await page.evaluate(() => { const a = window.__app; for (let i = 0; i < 200; i++) a.sim.step(1/60); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test/m1.png' });
  // undo twice
  await page.keyboard.press('Control+z'); await page.waitForTimeout(400); await page.keyboard.press('Control+z'); await page.waitForTimeout(800);
  const u = await page.evaluate(() => { const a = window.__app, g = a.S.garments.find(g => g.gen === 'top'); return g.pieces.map(p => p.name).join(','); });
  console.log('after undo', u);
  // exports
  const ex = await page.evaluate(() => { const a = window.__app; let svg = '', err=''; try { a.save = (n, d) => { svg += n + ':' + (typeof d === 'string' ? d.length : d.size) + ' '; }; document.querySelector('[data-x=svg]').click(); document.querySelector('[data-x=tech]').click(); document.querySelector('[data-x=json]').click(); } catch (e) { err = e.message; } return svg + err; });
  console.log('exports', ex);
  console.log(errs.join('\n'));
  await browser.close();
})();
