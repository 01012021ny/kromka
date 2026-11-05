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
