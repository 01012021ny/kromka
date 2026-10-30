// Общее для e2e: открыть приложение, перехватить сохранение файлов, упасть на любой ошибке страницы
import { test as base, expect } from '@playwright/test';
import path from 'path';
import { pathToFileURL } from 'url';

const APP_URL = pathToFileURL(path.resolve('dist/index.html')).href;
// офлайн не грузятся Google Fonts — это не ошибка приложения
const IGNORED_CONSOLE = /Failed to load resource|net::ERR_/;

export const test = base.extend({
  pageErrors: [
    async ({ page }, use) => {
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error' && !IGNORED_CONSOLE.test(m.text())) errs.push('console: ' + m.text()); });
      await use(errs);
      expect(errs, 'ошибки на странице').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

// hash '#local' — физика в основном потоке
export async function openApp(page, hash = '') {
  await page.goto(APP_URL + hash);
  await page.waitForFunction(() => window.__app?.sim?.N > 0, null, { timeout: 30_000 });
}

// app.save → window.__saved вместо скачивания
export async function captureSaves(page) {
  await page.evaluate(() => {
    window.__saved = [];
    window.__app.save = async (name, data) => {
      const buf = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new TextEncoder().encode(data);
      let s = '';
      for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
      window.__saved.push({ name, b64: btoa(s) });
    };
  });
}

export async function savedFiles(page, count) {
  await expect.poll(() => page.evaluate(() => window.__saved.length), { timeout: 30_000 }).toBe(count);
  const files = await page.evaluate(() => window.__saved);
  return files.map((f) => ({ name: f.name, buf: Buffer.from(f.b64, 'base64') }));
}

// статистика частиц ткани (метры): NaN/∞, средняя и минимальная высота
export function clothStats(page) {
  return page.evaluate(() => {
    const x = window.__app.sim.x, n = x.length / 3;
    let bad = 0, sy = 0, ymin = Infinity;
    for (let i = 0; i < n; i++) {
      const y = x[i * 3 + 1];
      if (!Number.isFinite(x[i * 3]) || !Number.isFinite(y) || !Number.isFinite(x[i * 3 + 2])) { bad++; continue; }
      sy += y; ymin = Math.min(ymin, y);
    }
    return { n, bad, meanY: sy / n, minY: ymin, t: window.__app.sim.t };
  });
}
