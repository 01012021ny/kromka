import { test, expect, openApp, clothStats } from './fixtures.js';

test('физика в воркере: вещи садятся на манекен и не сползают', async ({ page }) => {
  await openApp(page);
  expect(await page.evaluate(() => window.__app.sim.isWorker)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__app.sim.settled), { timeout: 60_000, intervals: [1000] }).toBe(true);

  const a = await clothStats(page);
  expect(a.bad, 'частицы с NaN/∞').toBe(0);
  expect(a.minY, 'ткань ниже пола').toBeGreaterThan(0);

  // разбудить и дождаться нового покоя: под собственным весом вещь не должна съезжать
  await page.evaluate(() => window.__app.sim.wake());
  await expect.poll(async () => (await clothStats(page)).t, { timeout: 30_000 }).toBeGreaterThan(a.t + 1);
  await expect.poll(() => page.evaluate(() => window.__app.sim.settled), { timeout: 60_000, intervals: [500] }).toBe(true);
  const b = await clothStats(page);
  console.log(`сползание за ${(b.t - a.t).toFixed(1)} с: ${((b.meanY - a.meanY) * 1000).toFixed(1)} мм`);
  expect(b.bad).toBe(0);
  expect(Math.abs(b.meanY - a.meanY), 'смещение средней высоты, м').toBeLessThan(0.01);
});

test('#local: физика в основном потоке тоже идёт', async ({ page }) => {
  await openApp(page, '#local');
  expect(await page.evaluate(() => !!window.__app.sim.isWorker)).toBe(false);
  await expect.poll(async () => (await clothStats(page)).t, { timeout: 60_000 }).toBeGreaterThan(1);
  const s = await clothStats(page);
  expect(s.bad).toBe(0);
  expect(s.minY).toBeGreaterThan(0);
});
