import { test, expect, openApp, captureSaves, savedFiles, clothStats } from './fixtures.js';

test('джинсы: основа из каталога → 3D без внутренних деталей → паспорт образца для пошива', async ({ page }) => {
  await openApp(page, '#local');
  await page.click('[data-add=flare]');
  await expect.poll(() => page.evaluate(() => window.__app.S.garments.some((g) => g.preset === 'flare'))).toBe(true);
  const info = await page.evaluate(() => {
    const a = window.__app, g = a.S.garments.find((x) => x.preset === 'flare');
    return {
      pieces: g.pieces.length, inner: g.pieces.filter((p) => p.inner).length,
      inSim: a.sim.pieces.filter((r) => r.garment.id === g.id).length,
      pocketing: g.pieces.filter((p) => p.name.startsWith('Мешковина')).every((p) => a.S.materials.find((m) => m.id === p.mat)?.presetId === 'pock'),
    };
  });
  expect(info).toEqual({ pieces: 16, inner: 7, inSim: 9, pocketing: true });

  // параметры силуэта в инспекторе; физика без NaN
  await expect(page.locator('#gp_kneeY')).toBeVisible();
  await expect(page.locator('#gp_jeans')).toBeChecked();
  await page.waitForTimeout(2500);
  expect((await clothStats(page)).bad).toBe(0);

  // паспорт: внутренние детали, накладки отдельными деталями, порядок пошива джинсов
  await captureSaves(page);
  await page.click('#smpPass');
  const [pass] = await savedFiles(page, 1);
  expect(pass.name).toMatch(/^kromka-pasport-.+\.html$/);
  const html = pass.buf.toString('utf8');
  for (const s of ['Мешковина передняя (лев.)', 'Гульфик', 'Задний карман (Задняя половинка (прав.))', 'Часовой карман', 'Пояс и шлёвки', 'J-строчку', 'сгиб, обтачка'])
    expect(html, s).toContain(s);
});
