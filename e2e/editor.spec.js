import { test, expect, openApp, captureSaves, savedFiles } from './fixtures.js';

// состояние лонгслива (изделие gen 'top' в стартовом проекте)
const topState = (page) => page.evaluate(() => {
  const a = window.__app, g = a.S.garments.find((g) => g.gen === 'top'), p = g.pieces.find((p) => p.name === 'Перед');
  const area = (pts) => { let s = 0; for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; s += x0 * y1 - x1 * y0; } return Math.abs(s) / 2; };
  return {
    names: g.pieces.map((p) => p.name), seams: g.seams.length, hist: a.history.map((h) => h.label),
    corner: p ? p.pts[p.corners[1].i].slice() : null,
    area: g.pieces.filter((p) => p.name.startsWith('Перед')).reduce((s, p) => s + area(p.pts), 0),
  };
});

test('2D-редактор: точка, разрез от руки, отмена, экспорт из меню', async ({ page }) => {
  await openApp(page);
  const s0 = await topState(page);
  expect(s0.names).toEqual(['Перед', 'Спинка', 'Рукав левый', 'Рукав правый']);

  // приблизить «Перед» в 2D и посчитать экранные координаты угла низа и линии разреза
  const pos = await page.evaluate(() => {
    const a = window.__app, g = a.S.garments.find((g) => g.gen === 'top'), p = g.pieces.find((p) => p.name === 'Перед'), ed = a.editor;
    a.select({ g: g.id, p: p.id });
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const [x, y] of p.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    ed.v.cx = p.view.x + (x0 + x1) / 2; ed.v.cy = p.view.y + (y0 + y1) / 2; ed.v.s = Math.min(ed.W / (x1 - x0 + 40), ed.H / (y1 - y0 + 40)); ed.dirty = true;
    const r = ed.cv.getBoundingClientRect(), c = p.pts[p.corners[1].i];
    const [sx, sy] = ed.toS(c[0] + p.view.x, c[1] + p.view.y), ym = (y0 + y1) / 2;
    const a1 = ed.toS(x0 - 5 + p.view.x, ym + 10 + p.view.y), a2 = ed.toS(x1 + 5 + p.view.x, ym - 10 + p.view.y);
    return { cx: r.left + sx, cy: r.top + sy, cut: [r.left + a1[0], r.top + a1[1], r.left + a2[0], r.top + a2[1]] };
  });

  // перетащить угол
  await page.mouse.move(pos.cx, pos.cy); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(pos.cx + i * 6, pos.cy + i * 3);
  await page.mouse.up();
  await expect.poll(async () => (await topState(page)).hist.at(-1)).toBe('Перемещение точки');
  const s1 = await topState(page);
  expect(Math.hypot(s1.corner[0] - s0.corner[0], s1.corner[1] - s0.corner[1]), 'угол сдвинулся, см').toBeGreaterThan(1);

  // разрез от руки поперёк детали
  await page.keyboard.press('f');
  await page.mouse.move(pos.cut[0], pos.cut[1]); await page.mouse.down();
  for (let i = 1; i <= 30; i++) await page.mouse.move(pos.cut[0] + ((pos.cut[2] - pos.cut[0]) * i) / 30, pos.cut[1] + ((pos.cut[3] - pos.cut[1]) * i) / 30 + Math.sin(i / 4) * 15);
  await page.mouse.up();
  await expect.poll(async () => (await topState(page)).hist.at(-1)).toBe('Разрез детали');
  const s2 = await topState(page);
  expect(s2.names).toContain('Перед · часть');
  expect(s2.names.length).toBe(5);
  expect(s2.seams).toBeGreaterThan(s1.seams);
  expect(Math.abs(s2.area - s1.area) / s1.area, 'площадь «Перед» сохранена').toBeLessThan(0.005);

  // две отмены возвращают исходные детали и угол
  await page.keyboard.press('v');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await topState(page)).names).toEqual(s0.names);
  const s3 = await topState(page);
  expect(s3.corner).toEqual(s0.corner);
  expect(s3.seams).toBe(s0.seams);

  // меню «Файл»: техкарта и проект
  await captureSaves(page);
  await page.click('#bExport'); await page.click('[data-x=tech]');
  await page.click('#bExport'); await page.click('[data-x=json]');
  const [tech, json] = await savedFiles(page, 2);
  expect(tech.name).toBe('kromka-tehkarta.html');
  const html = tech.buf.toString('utf8');
  expect(html).toContain('КРОМКА · ТЕХКАРТА');
  expect(html).toContain('Порядок пошива');
  expect(json.name).toBe('kromka-proekt.json');
  const proj = JSON.parse(json.buf.toString('utf8'));
  expect(proj.app).toBe('kromka');
  expect(proj.garments.map((g) => g.gen)).toContain('top');
});
