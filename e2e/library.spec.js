import { test, expect, openApp, clothStats } from './fixtures.js';

test('библиотека: поиск, фасеты, добавление карточки и сборка образа на манекене', async ({ page }) => {
  await openApp(page, '#local');
  const shown = () => page.locator('#libList [data-add]').count();
  const all = await shown();
  expect(all).toBeGreaterThan(30);

  // поиск по кириллице и по латинице дают одно и то же
  await page.fill('#libQ', 'оуэнс');
  const ru = await shown();
  await page.fill('#libQ', 'rick owens');
  expect(await shown()).toBe(ru);
  expect(ru).toBeGreaterThan(4);

  // фасет «if six was nine» + «кожа» — пересечение
  await page.fill('#libQ', '');
  await page.click('[data-fk=style][data-fv=iswn]');
  const iswn = await shown();
  await page.click('[data-fk=mat][data-fv="кожа"]');
  const both = await shown();
  expect(both).toBeGreaterThan(0);
  expect(both).toBeLessThan(iswn);
  await expect(page.locator('#libN')).toContainText(`${both} из`);
  // образы отфильтрованы по ассоциации
  await expect(page.locator('#libOut [data-outfit=O-iswn]')).toHaveCount(1);
  await expect(page.locator('#libOut [data-outfit=O-julius]')).toHaveCount(0);

  // добавить карточку — у изделия видна ассоциация и переключатель деталей
  await page.click('#libList [data-add=L-lflare]');
  await expect(page.locator('#right .libinfo')).toContainText('if six was nine');

  // собрать образ: вещи заменяются, обувь — по образу, ткань живая
  await page.click('#libOut [data-outfit=O-iswn]');
  const st = await page.evaluate(() => ({ gs: window.__app.S.garments.map((g) => g.preset), heel: window.__app.S.accessories.find((a) => a.type === 'shoes')?.p.heel }));
  expect(st.gs).toEqual(['L-lflare', 'tee', 'L-moto']);
  expect(st.heel).toBe(5);
  await expect(page.locator('#toast')).toContainText('Образ');
  await page.waitForTimeout(2500);
  const cs = await clothStats(page);
  expect(cs.bad).toBe(0);
  expect(cs.n).toBeGreaterThan(1500);

  // «Вернуть» — прежний набор изделий
  await page.click('#toast button');
  expect(await page.evaluate(() => window.__app.S.garments.map((g) => g.preset))).toContain('L-lflare');
});

test('молнии и фурнитура: между бортами, в шве, декоративная, ряд люверсов — в себестоимости', async ({ page }) => {
  await openApp(page, '#local');
  await page.evaluate(() => { const a = window.__app; for (const g of [...a.S.garments]) a.removeGarment(g); a.addGarment('coat'); });
  const sel = (name, edge) => page.evaluate(([n, e]) => {
    const a = window.__app, g = a.S.garments[0], p = g.pieces.find((x) => x.name === n), c = p.corners.find((k) => p.meta[k.id].name === e);
    a.select({ g: g.id, p: p.id, edge: c.id });
  }, [name, edge]);

  // открытый борт → «Соединить молнией» с бортом правой полочки
  await sel('Полочка левая', 'борт');
  await expect(page.locator('#zPair')).toContainText('Полочка правая');
  await page.click('#zPair');
  const z = await page.evaluate(() => { const g = window.__app.S.garments[0]; const s = g.seams.find((x) => x.zip); return s && { closure: s.closure, open: s.zip.open, rev: s.rev != null }; });
  expect(z).toEqual({ closure: true, open: true, rev: true });
  await expect(page.locator('#zOff')).toBeVisible();

  // ряд люверсов вдоль низа спинки
  await sel('Спинка', 'низ');
  await page.fill('#rwS', '4');
  await page.click('#rwGo');
  const eyelets = await page.evaluate(() => window.__app.S.garments[0].pieces.find((p) => p.name === 'Спинка').hardware.filter((h) => h.type === 'eyelet').length);
  expect(eyelets).toBeGreaterThan(8);

  // декоративная молния кистью
  await page.evaluate(() => {
    const a = window.__app, g = a.S.garments[0], p = g.pieces.find((x) => x.name === 'Рукав левый');
    a.toolOpts.brushMode = 'zip';
    a.addStroke(g, p, [[-3, -30], [-3, -40], [-3, -50]]);
  });
  const sl = await page.evaluate(() => { const p = window.__app.S.garments[0].pieces.find((x) => x.name === 'Рукав левый'); return { zips: p.strokes.filter((s) => s.mode === 'zip').length, pulls: p.hardware.filter((h) => h.zipOf).length }; });
  expect(sl).toEqual({ zips: 1, pulls: 1 });

  // себестоимость изделия: молнии — 2 шт., люверсы считаются
  await page.evaluate(() => window.__app.select({ g: window.__app.S.garments[0].id }));
  await page.click('#costSec summary');
  const cost = page.locator('#costBody');
  await expect(cost).toContainText('Молния');
  await expect(cost).toContainText('разъёмная');
  await expect(cost).toContainText('Люверс');
  await expect(page.locator('#right .steps-list')).toContainText('Молнии');

  // распороть шов-молнию инструментом «Шов» (Alt+клик) — бегунок и зубья уходят
  await page.evaluate(() => { const a = window.__app, g = a.S.garments[0], s = g.seams.find((x) => x.zip); a.commit('x'); g.seams = g.seams.filter((x) => x !== s); a.changed({ geo: true }); });
  const left = await page.evaluate(() => window.__app.S.garments[0].pieces.flatMap((p) => p.hardware.filter((h) => typeof h.zipOf === 'string' && h.zipOf.startsWith('seam:'))).length);
  expect(left).toBe(0);
  const cs = await clothStats(page);
  expect(cs.bad).toBe(0);
});
