import { test, expect, openApp, clothStats, captureSaves, savedFiles } from './fixtures.js';

test('импорт лекал из SVG: диалог → место на манекене → развернуть по сгибу → сшить → 3D и раскладка', async ({ page }) => {
  await openApp(page, '#local');
  await page.evaluate(() => { const a = window.__app; for (const g of [...a.S.garments]) a.removeGarment(g); });

  // Файл → Импорт лекал…: в диалоге 4 контура, контрольный квадрат снят, единицы — из файла
  await page.setInputFiles('#fileImp', 'e2e/fixtures/tee-halves.svg');
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('#impGo')).toHaveText('Добавить деталей: 3');
  await expect(page.locator('#impU')).toHaveValue('mm');
  await expect(page.locator('#dlg')).toContainText('контрольный квадрат');
  await page.click('#impGo');
  const g0 = await page.evaluate(() => { const g = window.__app.S.garments[0]; return { gen: g.gen, kinds: g.pieces.map((p) => p.place.kind), n: window.__app.sim.N }; });
  expect(g0.gen).toBe('import');
  expect(g0.kinds).toEqual(['free', 'free', 'free']); // «отдельно» — только крой, в 3D ничего
  expect(g0.n).toBe(0);

  // перед: место на манекене через инспектор, сгиб — выбранная прямая сторона
  const foldOf = (i) => page.evaluate((k) => {
    const a = window.__app, g = a.S.garments[0], p = g.pieces[k], x0 = Math.min(...p.pts.map((q) => q[0]));
    const c = p.corners.find((cc, j) => { const n = p.pts.length, i1 = p.corners[(j + 1) % p.corners.length].i; const pts = []; for (let t = cc.i; ; t = (t + 1) % n) { pts.push(p.pts[t]); if (t === i1) break; } const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]); return Math.max(...xs) - Math.min(...xs) < 0.3 && Math.max(...ys) - Math.min(...ys) > 20 && Math.min(...xs) <= x0 + 0.01; });
    a.select({ g: g.id, p: p.id, edge: c.id });
  }, i);
  await foldOf(0);
  await page.click('#plFold');
  await page.selectOption('#plRole', 'front');
  await foldOf(1);
  await page.click('#plFold');
  await page.selectOption('#plRole', 'back');
  const placed = await page.evaluate(() => window.__app.S.garments[0].pieces.slice(0, 2).map((p) => { const xs = p.pts.map((q) => q[0]); return { kind: p.place.kind, side: p.place.side, w: Math.max(...xs) - Math.min(...xs), cx: (Math.max(...xs) + Math.min(...xs)) / 2 }; }));
  expect(placed.map((p) => p.side)).toEqual(['front', 'back']);
  for (const p of placed) { expect(p.w).toBeGreaterThan(49); expect(Math.abs(p.cx)).toBeLessThan(0.1); }

  // название стороны — из списка
  await page.evaluate(() => { const a = window.__app, g = a.S.garments[0], p = g.pieces[0]; a.select({ g: g.id, p: p.id, edge: p.corners[0].id }); });
  await page.fill('#eName', 'низ');
  await page.dispatchEvent('#eName', 'change');
  expect(await page.evaluate(() => { const p = window.__app.S.garments[0].pieces[0]; return p.meta[p.corners[0].id].name; })).toBe('низ');

  // сшить плечи и бока — изделие садится на манекен
  await page.evaluate(() => {
    const a = window.__app, g = a.S.garments[0], [F, B] = g.pieces;
    const edges = (p) => p.corners.map((c, k) => { const n = p.pts.length, i1 = p.corners[(k + 1) % p.corners.length].i; const pts = []; for (let i = c.i; ; i = (i + 1) % n) { pts.push(p.pts[i]); if (i === i1) break; } const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]); return { cid: c.id, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), y0: Math.min(...ys), mx: (xs[0] + xs[xs.length - 1]) / 2 }; });
    const top = (p) => Math.max(...p.pts.map((q) => q[1]));
    const sh = (p) => edges(p).filter((e) => e.y0 > top(p) - 8 && Math.abs(e.mx) > 6 && e.w > 6).sort((u, v) => u.mx - v.mx);
    const side = (p) => edges(p).filter((e) => e.h > 30 && e.w < 1).sort((u, v) => u.mx - v.mx);
    const [fs, bs, fd, bd] = [sh(F), sh(B), side(F), side(B)];
    a.addSeam(g, { p: F.id, e: fs[0].cid }, { p: B.id, e: bs[1].cid });
    a.addSeam(g, { p: F.id, e: fs[1].cid }, { p: B.id, e: bs[0].cid });
    a.addSeam(g, { p: F.id, e: fd[0].cid }, { p: B.id, e: bd[1].cid });
    a.addSeam(g, { p: F.id, e: fd[1].cid }, { p: B.id, e: bd[0].cid });
  });
  await page.waitForTimeout(2500);
  const st = await page.evaluate(() => { const s = window.__app.sim; let ymax = -1e9; for (let i = 0; i < s.N; i++) ymax = Math.max(ymax, s.x[3 * i + 1]); return { N: s.N, ymax }; });
  expect(st.N).toBeGreaterThan(500);
  expect(st.ymax).toBeGreaterThan(135); // держится на плечах
  const cs = await clothStats(page);
  expect(cs.bad).toBe(0);
  // все три детали — в раскладке (рукав «отдельно» тоже кроится)
  await expect.poll(() => page.evaluate(() => (window.__app.layout || []).flatMap((r) => r.placed || []).length)).toBeGreaterThanOrEqual(3);
});

test('наш PDF А0 и А4 со склейкой импортируются обратно целыми деталями с припусками', async ({ page }) => {
  await openApp(page, '#local');
  await page.evaluate(() => { const a = window.__app; for (const g of [...a.S.garments]) a.removeGarment(g); a.addGarment('tee'); });
  await captureSaves(page);
  for (const [k, fmt] of ['pdfA0', 'pdf'].entries()) {
    await page.evaluate(() => document.querySelector('#menu [data-x=prod]').click());
    await page.check(`input[name=fmt][value=${fmt}]`);
    await page.click('#xGo');
    await expect.poll(() => page.evaluate(() => window.__saved.length), { timeout: 60_000 }).toBe(k + 1);
    await expect(page.locator('#dlg')).toBeHidden();
  }
  const files = await savedFiles(page, 2);
  for (const f of files) {
    await page.setInputFiles('#fileImp', { name: f.name, mimeType: 'application/pdf', buffer: f.buf });
    await expect(page.locator('#impGo')).toHaveText('Добавить деталей: 4');
    const sas = await page.locator('#dlg .imp-c .s').allTextContents();
    expect(sas.filter((t) => /припуск/.test(t)).length).toBe(4); // линия шва найдена внутри линии реза
    await page.click('#impX');
  }
});
