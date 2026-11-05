import { test, expect, openApp } from './fixtures.js';

test('вкладка «Изделия»: удалить изделие целиком из списка, вернуть, свернуть детали, Del', async ({ page }) => {
  await openApp(page, '#local');
  await page.click('[data-add=jeans]');
  const count = () => page.evaluate(() => window.__app.S.garments.length);
  const n0 = await count();
  const id = await page.evaluate(() => window.__app.S.garments.find((g) => g.preset === 'jeans').id);

  // свернуть / развернуть список деталей
  const rows = () => page.locator(`#tree [data-g="${id}"] ~ .pc`).count();
  expect(await rows()).toBe(16);
  await page.click(`#tree [data-fold="${id}"]`);
  expect(await rows()).toBe(0);
  await expect(page.locator(`#tree [data-g="${id}"] .gc`)).toContainText('16 дет.');
  await page.click(`#tree [data-fold="${id}"]`);
  expect(await rows()).toBe(16);

  // ✕ — удалить целиком, «Вернуть» в сообщении — восстановить со всеми деталями
  await page.click(`#tree [data-del="${id}"]`);
  expect(await count()).toBe(n0 - 1);
  await expect(page.locator('#toast')).toContainText('Удалено целиком');
  await page.click('#toast button');
  expect(await count()).toBe(n0);
  expect(await page.evaluate((gid) => window.__app.S.garments.find((g) => g.id === gid)?.pieces.length, id)).toBe(16);

  // Del при выбранном изделии
  await page.click(`#tree [data-g="${id}"] .n`);
  await page.keyboard.press('Delete');
  expect(await count()).toBe(n0 - 1);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__app.sim.N > 0 || window.__app.S.garments.length === 0)).toBe(true);
});

test('3D рисуется по требованию: в покое кадр не перерисовывается, после правки — да', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    const v = window.__app.view3d;
    v._dirty = 0; v._lastRender = performance.now();
    const idle = v.frame(null, false);
    v.invalidate();
    const after = v.frame(null, false);
    return { idle, after, dpr: v.dpr, dprMax: v.dprMax };
  });
  expect(r.idle).toBe(false);
  expect(r.after).toBe(true);
  expect(r.dpr).toBeLessThanOrEqual(r.dprMax);
});

test('обработка краёв: обтачка горловины, бейка, подкладка — из инспектора', async ({ page }) => {
  await openApp(page, '#local');
  await page.evaluate(() => { const a = window.__app; for (const g of [...a.S.garments]) a.removeGarment(g); a.addGarment('coat'); });
  const ids = await page.evaluate(() => { const g = window.__app.S.garments[0]; const p = g.pieces.find((x) => x.name === 'Спинка'); return { g: g.id, p: p.id, neck: p.corners.find((c) => p.meta[c.id].name === 'горловина').id, n: g.pieces.length }; });
  // выбрать горловину спинки → обтачка
  await page.evaluate((o) => window.__app.select({ g: o.g, p: o.p, edge: o.neck }), ids);
  await page.click('#fFace');
  await expect(page.locator('#toast')).toContainText('Обтачка');
  await expect.poll(() => page.evaluate((o) => window.__app.garment(o.g).pieces.filter((p) => p.name.startsWith('Обтачка:') && p.inner).length, ids)).toBe(1);
  // та же сторона уже сшита — кнопок нет, есть пояснение
  await expect(page.locator('#fFace')).toHaveCount(0);
  // подкладка из инспектора изделия
  await page.evaluate((o) => window.__app.select({ g: o.g }), ids);
  await page.click('#lnAdd');
  await expect.poll(() => page.evaluate((o) => window.__app.garment(o.g).pieces.filter((p) => p.lining).length, ids)).toBe(ids.n);
  await expect(page.locator('.steps-list')).toContainText('Подкладка');
  // в 3D — только основные детали
  await page.waitForTimeout(800);
  expect(await page.evaluate((o) => window.__app.sim.pieces.filter((r) => r.garment.id === o.g).length, ids)).toBe(ids.n);
  // убрать подкладку
  await page.click('#lnDel');
  await expect.poll(() => page.evaluate((o) => window.__app.garment(o.g).pieces.filter((p) => p.lining).length, ids)).toBe(0);
});

test('узлы: лонгслив с воронкой и манжетами из каталога, стойка параметром', async ({ page }) => {
  await openApp(page, '#local');
  await page.click('[data-add=funnel]');
  const g = await page.evaluate(() => { const g = window.__app.S.garments.find((x) => x.preset === 'funnel'); return { id: g.id, names: g.pieces.map((p) => p.name) }; });
  expect(g.names).toEqual(expect.arrayContaining(['Воронка', 'Воронка (внутренняя)', 'Манжета (лев.)', 'Манжета (прав.)']));
  await expect(page.locator('.steps-list')).toContainText('Воротник-воронка');
  // переключить на стойку высотой 4 см
  await page.locator('#gp_collar_n').fill('1'); await page.locator('#gp_collar_n').dispatchEvent('change');
  await page.locator('#gp_collarH_n').fill('4'); await page.locator('#gp_collarH_n').dispatchEvent('change');
  await expect.poll(() => page.evaluate((id) => window.__app.garment(id).pieces.some((p) => p.name === 'Стойка'), g.id)).toBe(true);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => { const x = window.__app.sim.x; for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) return false; return true; })).toBe(true);
});

test('✋ Тянуть: ткань хватается мышью без Alt; смена обуви — одежда надевается заново', async ({ page }) => {
  await openApp(page, '#local');
  await page.click('#bGrab');
  await expect(page.locator('#bGrab')).toHaveClass(/on/);
  await page.waitForTimeout(1500);
  const pt = await page.evaluate(() => {
    const a = window.__app, v = a.view3d, r = a.sim.pieces.find((q) => q.piece.place.kind === 'leg' && q.piece.place.side === 'front');
    const i = r.off + Math.floor(r.n * 0.55);
    const V = new v.camera.position.constructor(a.sim.x[3 * i], a.sim.x[3 * i + 1], a.sim.x[3 * i + 2]).project(v.camera);
    const rect = v.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((V.x + 1) / 2) * rect.width, y: rect.top + ((1 - V.y) / 2) * rect.height };
  });
  await page.mouse.move(pt.x, pt.y); await page.mouse.down();
  await page.mouse.move(pt.x + 40, pt.y + 10, { steps: 6 });
  expect(await page.evaluate(() => !!window.__app.sim.grab)).toBe(true);
  await page.mouse.up();
  expect(await page.evaluate(() => window.__app.sim.grab)).toBeFalsy();
  // смена обуви → одежда надевается заново (свежая сборка: t сбрасывается)
  const t0 = await page.evaluate(() => window.__app.sim.t);
  await page.evaluate(() => { const a = window.__app, s = a.S.accessories.find((x) => x.type === 'shoes'); s.p.style = 'low'; s.p.shaft = 0; a.rebuildAccessories(); });
  expect(await page.evaluate(() => window.__app.sim.t)).toBeLessThan(t0);
});
