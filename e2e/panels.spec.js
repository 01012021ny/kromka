import { test, expect, openApp } from './fixtures.js';

test('все вкладки, инспекторы, справка и вид раскладки открываются без ошибок', async ({ page }) => {
  await openApp(page);
  const left = page.locator('#left'), right = page.locator('#right');

  for (const [tab, title] of [['body', 'Манекен'], ['garments', 'Библиотека лекал'], ['materials', 'Ткани проекта'], ['details', 'Детали и слои'], ['acc', 'Обувь и аксессуары'], ['layout', 'Раскладка и отходы']]) {
    await page.click(`#steps [data-tab=${tab}]`);
    await expect(left.locator('h2').first()).toHaveText(title);
    await expect(page.locator(`#steps [data-tab=${tab}]`)).toHaveClass(/on/);
  }
  await expect(page.locator('#measRead')).toHaveCount(0);

  // раскладка на столе ↔ лекала
  await page.click('#lShow');
  await expect(page.locator('#layoutView')).toBeVisible();
  await expect(page.locator('#v2d')).toBeHidden();
  await page.click('#tools2d [data-mode=pattern]');
  await expect(page.locator('#v2d')).toBeVisible();

  // манекен: мерки строятся
  await page.click('#steps [data-tab=body]');
  await expect(page.locator('#measRead [data-meas]').first()).toBeVisible();

  // инспекторы: изделие → деталь → ткань → аксессуар
  await page.click('#steps [data-tab=garments]');
  await page.locator('#tree .gh .n', { hasText: 'Лонгслив' }).click();
  await expect(right.locator('#gName')).toHaveValue(/Лонгслив/);
  await expect(right.getByText('Размерный ряд')).toBeVisible();
  await page.locator('#tree .pc', { hasText: 'Спинка' }).first().click();
  await expect(right.locator('#pName')).toHaveValue('Спинка');
  await expect(right.locator('[data-edge]').first()).toBeVisible();

  await page.click('#steps [data-tab=materials]');
  await left.locator('[data-m]').first().click();
  await expect(right.locator('#mName')).toBeVisible();
  await expect(right.getByText('Физика (выводится из состава)')).toBeVisible();

  await page.click('#steps [data-tab=acc]');
  await left.locator('[data-acc] .t').first().click();
  await expect(right.locator('#aName')).toBeVisible();

  // инструмент из панели «Детали» включается в тулбаре 2D
  await page.click('#steps [data-tab=details]');
  await left.locator('[data-tool=brush]').click();
  await expect(page.locator('#tools2d [data-tool=brush]')).toHaveClass(/on/);
  await expect(page.locator('#hint')).toContainText('Кисть');

  // справка открывается и закрывается
  await page.click('#bHelp');
  await expect(page.locator('#help')).toBeVisible();
  await page.click('#help [data-close]');
  await expect(page.locator('#help')).toBeHidden();

  // строка состояния
  await expect(page.locator('#stats')).toContainText('точек');
  await expect(page.locator('#waste')).toContainText('использование');
});

test('инспектор и левую панель можно скрыть: ×, полоска у края, клавиши [ ]; 3D занимает место', async ({ page }) => {
  await openApp(page);
  const w3d = () => page.evaluate(() => document.getElementById('v3d').clientWidth);
  const before = await w3d();
  await page.click('#rClose');
  await expect(page.locator('#right')).toBeHidden();
  await expect(page.locator('#rOpen')).toBeVisible();
  await expect.poll(w3d).toBeGreaterThan(before + 60);
  await page.keyboard.press('BracketLeft');
  await expect(page.locator('#left')).toBeHidden();
  // состояние запоминается
  await page.reload();
  await page.waitForFunction(() => window.__app?.sim?.N > 0, null, { timeout: 30_000 });
  await expect(page.locator('#right')).toBeHidden();
  await page.click('#rOpen');
  await expect(page.locator('#right')).toBeVisible();
  await page.keyboard.press('BracketLeft');
  await expect(page.locator('#left')).toBeVisible();
  await expect.poll(w3d).toBe(before);
});
