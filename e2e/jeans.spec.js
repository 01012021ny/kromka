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
  expect(info).toEqual({ pieces: 17, inner: 8, inSim: 9, pocketing: true }); // клёш: контурный пояс + обтачка пояса

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
  for (const s of ['Мешковина передняя (лев.)', 'Гульфик', 'Задний карман (Задняя половинка (прав.))', 'Часовой карман', 'Пояс и шлёвки', 'J-строчку', 'Обтачка пояса', 'Контурный пояс'])
    expect(html, s).toContain(s);
});

test('джинсы: хватит ли моего отреза, себестоимость, сгиб у колена', async ({ page }) => {
  await openApp(page, '#local');
  await page.evaluate(() => { const a = window.__app; for (const g of [...a.S.garments]) a.removeGarment(g); });
  await page.click('[data-add=jeans]');
  const gid = await page.evaluate(() => window.__app.S.garments[0].id);

  // сгиб у колена из инспектора: появляются нижние части переда
  await page.locator('#gp_artKnee_n').fill('2.5');
  await page.locator('#gp_artKnee_n').dispatchEvent('change');
  await expect.poll(() => page.evaluate((id) => window.__app.garment(id).pieces.filter((p) => p.name.startsWith('Перед ниже колена')).length, gid)).toBe(2);

  // себестоимость раскрывается и считает итог
  await page.click('#costSec summary');
  await expect(page.locator('#costBody')).toContainText('Итого');
  await expect(page.locator('#costBody')).toContainText('Молния');

  // раскладка: отрез 0,5 м — не хватает (красное), 3 м — хватает (зелёное)
  await page.click('nav button[data-tab=layout]');
  await expect.poll(() => page.evaluate(() => (window.__app.layout || []).length)).toBeGreaterThan(0);
  const denim = await page.evaluate(() => window.__app.layout.find((r) => r.mat.presetId === 'den12').mat.id);
  const stock = page.locator(`[data-stock="${denim}"]`);
  await stock.fill('0.5'); await stock.dispatchEvent('change');
  await expect(page.locator('#left .note.neg', { hasText: 'не хватает' })).toBeVisible();
  await expect(page.locator('#waste')).toContainText('отреза не хватает');
  await page.locator(`[data-stock="${denim}"]`).fill('3'); await page.locator(`[data-stock="${denim}"]`).dispatchEvent('change');
  await expect(page.locator('#left .note.pos', { hasText: 'хватает' })).toBeVisible();
});
