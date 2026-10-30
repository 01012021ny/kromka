const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERR: ' + e.message + ' ' + (e.stack||'').slice(0,300)));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL') && !m.text().includes('Failed to load resource')) errs.push('console: ' + m.text()); });
  await page.goto('file://' + process.cwd() + '/dist/index.html');
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(2500); const s = await page.evaluate(() => { const a = window.__app; return { w: !!a.sim.isWorker, N: a.sim.N, t: +a.sim.t.toFixed(2), ms: +(a.sim.stepMs||0).toFixed(1), settled: a.sim.settled, y: a.sim.x.length ? +a.sim.x[1].toFixed(2) : null }; }); console.log(JSON.stringify(s)); }
  // measure main-thread frame rate during a fresh resew
  await page.evaluate(() => { document.querySelector('#bResew').click(); });
  const fr = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(n / 3); }; requestAnimationFrame(f); }));
  console.log('main fps during sim', fr.toFixed(0));
  await page.waitForTimeout(6000);
  await page.evaluate(() => document.querySelector('[data-cam=front]').click());
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test/w1.png' });
  console.log(errs.join('\n'));
  await browser.close();
})();
