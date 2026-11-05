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
