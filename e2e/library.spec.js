import { test, expect, openApp, clothStats } from './fixtures.js';

test('библиотека в отдельном окне: поиск, фасеты, образы; во вкладке 02 — недавние шаблоны', async ({ page }) => {
  await openApp(page, '#local');
  await page.click('#steps [data-tab=garments]');
  // быстрый доступ: пока ничего не добавляли — базовые шаблоны
  await expect(page.locator('#left')).toContainText('Начать с базового');
  await page.click('#libOpen');
  await expect(page.locator('#libWin')).toBeVisible();
  const shown = () => page.locator('#libList [data-add]').count();
  expect(await shown()).toBeGreaterThan(30);

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

  // добавить карточку — окно закрывается, у изделия видна ассоциация
  await page.click('#libList [data-add=L-lflare]');
  await expect(page.locator('#libWin')).toBeHidden();
  await expect(page.locator('#right .libinfo')).toContainText('if six was nine');
  // во вкладке 02 — недавние, первым — только что добавленный
  await page.click('#steps [data-tab=garments]');
  await expect(page.locator('#left')).toContainText('Недавние шаблоны');
  await expect(page.locator('#quick [data-add]').first()).toHaveAttribute('data-add', 'L-lflare');

  // окно по клавише L, вкладка «Образы» отфильтрована по ассоциации; Esc закрывает
  await page.keyboard.press('KeyL');
  await expect(page.locator('#libWin')).toBeVisible();
  await page.click('#lwTabs [data-v=outfits]');
  await expect(page.locator('#libList [data-outfit=O-iswn]')).toHaveCount(1);
  await expect(page.locator('#libList [data-outfit=O-julius]')).toHaveCount(0);
  await page.click('#lwTabs [data-v=sources]');
  await expect(page.locator('#libList')).toContainText('SHOWstudio');
  await page.keyboard.press('Escape');
  await expect(page.locator('#libWin')).toBeHidden();

  // собрать образ: вещи заменяются, обувь — по образу, слои разные, ткань живая
  await page.keyboard.press('KeyL');
  await page.click('#lwTabs [data-v=outfits]');
  await page.click('#libList [data-outfit=O-iswn]');
  const st = await page.evaluate(() => ({ gs: window.__app.S.garments.map((g) => g.preset), layers: window.__app.S.garments.map((g) => g.layer), heel: window.__app.S.accessories.find((a) => a.type === 'shoes')?.p.heel }));
  expect(st.gs).toEqual(['L-lflare', 'tee', 'L-moto']);
  expect(new Set(st.layers).size).toBe(3);
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

test('фигура и посадка: вещи подгоняются под манекен, второй верх надевается сверху, посадку можно отпустить', async ({ page }) => {
  await openApp(page, '#local');
  // второй верх с тем же слоем карточки встаёт поверх первого
  await page.evaluate(() => { const a = window.__app; a.addGarment('tee'); });
  const lay = await page.evaluate(() => Object.fromEntries(window.__app.S.garments.map((g) => [g.preset, g.layer])));
  expect(lay.tee).toBeGreaterThan(lay.long);
  // ▼ у футболки — под лонгслив
  await page.click('#steps [data-tab=garments]');
  const tee = await page.evaluate(() => window.__app.S.garments.find((g) => g.preset === 'tee').id);
  await page.click(`#tree [data-dn="${tee}"]`);
  const lay2 = await page.evaluate(() => Object.fromEntries(window.__app.S.garments.map((g) => [g.preset, g.layer])));
  expect(lay2.tee).toBeLessThan(lay2.long);
  // мужская фигура: предложение подогнать лекала, после — вещи под этот манекен
  await page.click('#steps [data-tab=body]');
  await expect(page.locator('#left')).toContainText('Все изделия построены под этот манекен');
  await page.click('[data-bp="3"]');
  await expect(page.locator('#left')).toContainText('Под другую фигуру построено');
  const before = await page.evaluate(() => window.__app.S.garments.find((g) => g.preset === 'dropc').params.len);
  await page.click('#toast button');
  await expect(page.locator('#left')).toContainText('Все изделия построены под этот манекен');
  const after = await page.evaluate(() => window.__app.S.garments.find((g) => g.preset === 'dropc').params.len);
  expect(after).toBeGreaterThan(before);
  // посадка: кнопка выключает и включает удержание
  await expect(page.locator('#bFit')).toHaveClass(/on/);
  await page.click('#bFit');
  await expect(page.locator('#bFit')).not.toHaveClass(/on/);
  expect(await page.evaluate(() => window.__app.sim.holdFit)).toBe(false);
  await page.click('#bFit');
  expect(await page.evaluate(() => window.__app.sim.holdFit)).toBe(true);
  const cs = await clothStats(page);
  expect(cs.bad).toBe(0);
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
