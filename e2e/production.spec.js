import { test, expect, openApp, captureSaves, savedFiles } from './fixtures.js';

// имена файлов внутри ZIP по заголовкам локальных записей
function zipNames(buf) {
  const names = [];
  for (let i = buf.indexOf('PK\x03\x04'); i >= 0; i = buf.indexOf('PK\x03\x04', i + 4)) names.push(buf.subarray(i + 30, i + 30 + buf.readUInt16LE(i + 26)).toString('utf8'));
  return names;
}

test('производство: тираж в раскладке, PDF А4, DXF+PLT, SVG-веер', async ({ page }) => {
  await openApp(page);

  // тираж S×1, M×2, L×1 по обоим изделиям → в раскладке 4 комплекта
  const perSet = await page.evaluate(() => window.__app.S.garments.map((g) => g.pieces.length));
  await page.evaluate(() => { const a = window.__app; a.layout = null; for (const g of a.S.garments) g.grading.qty = { S: 1, M: 2, L: 1 }; a.changed({ grade: true }); });
  await expect.poll(() => page.evaluate(() => (window.__app.layout || []).reduce((s, r) => s + r.placed.length, 0)), { timeout: 30_000 })
    .toBe(perSet.reduce((s, n) => s + n, 0) * 4);
  const rolls = await page.evaluate(() => window.__app.layout.map((r) => ({ name: r.mat.name, fail: r.placed.filter((x) => x.fail).length, util: r.util, len: r.length })));
  for (const r of rolls) {
    expect(r.fail, `${r.name}: детали не поместились`).toBe(0);
    expect(r.util, `${r.name}: использование ткани`).toBeGreaterThan(0.5);
    expect(r.len).toBeGreaterThan(0);
  }

  await captureSaves(page);
  const exportAs = async (fmt, allSizes) => {
    await page.click('#bExport'); await page.click('[data-x=prod]');
    await page.check(`#dlg input[name=fmt][value=${fmt}]`);
    if (allSizes) for (const cb of await page.$$('#dlg [data-xs]')) await cb.check();
    await page.click('#xGo');
    await expect(page.locator('#dlg')).toBeHidden({ timeout: 60_000 });
  };
  await exportAs('pdf', false);
  await exportAs('pdfA0', false);
  await exportAs('dxf', true);
  await exportAs('svg', true);
  const [pdf, a0, zip, svg] = await savedFiles(page, 4);

  expect(pdf.name).toBe('kromka-lekala-A4-M.pdf');
  expect(pdf.buf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.buf.subarray(-1024).toString('latin1')).toContain('%%EOF');
  // вектор: чертёж — форма (Form XObject), подписи — однобитные маски; никаких полностраничных растров
  const raw = pdf.buf.toString('latin1');
  expect(raw).toContain('/Subtype /Form');
  expect(raw).not.toContain('/ColorSpace /DeviceGray');
  // А0: детали целиком на листах, без склейки
  expect(a0.name).toBe('kromka-lekala-A0-M.pdf');
  const a0raw = a0.buf.toString('latin1');
  const a0pages = (a0raw.match(/\/Type \/Page /g) || []).length;
  expect(a0pages).toBeGreaterThan(0);
  expect(a0raw).toContain('/MediaBox [0 0 2383.937 3370.394]');

  expect(zip.name).toBe('kromka-lekala-XS-S-M-L-XL.zip');
  expect(zipNames(zip.buf).sort()).toEqual(['README.txt', 'kromka-XS-S-M-L-XL.dxf', 'kromka-XS-S-M-L-XL.plt']);

  expect(svg.name).toBe('kromka-veer-XS-S-M-L-XL.svg');
  const s = svg.buf.toString('utf8');
  expect(s.startsWith('<?xml')).toBe(true);
  expect(s.trimEnd().endsWith('</svg>')).toBe(true);
});
