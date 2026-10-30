// e2e: собранный dist/index.html открывается по file:// — сервер не нужен (npm run e2e сам пересобирает)
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  // физика тяжёлая: параллельные вкладки на 2-ядерном раннере CI мешают друг другу
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    browserName: 'chromium',
    viewport: { width: 1600, height: 900 },
    // WebGL без видеокарты
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
