import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
/** The installable web version (npm run build:web, src/web-app.ts). */
const WEB_APP_PORT = 4174;

export default defineConfig({
  testDir: './tests',
  // On an emulator, and slow: `npm run test:android` (playwright.android.config.js).
  testIgnore: 'android/**',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'mobile-chrome', testIgnore: ['android/**', 'web-app/**'], use: { ...devices['Pixel 7'], baseURL: `http://localhost:${PORT}` } },
    { name: 'web-app', testDir: './tests/web-app', use: { ...devices['Pixel 7'], baseURL: `http://localhost:${WEB_APP_PORT}` } },
    // Safari's engine, as on iPhones (npx playwright install webkit). SAFARI=all runs every test in it.
    { name: 'web-app-safari', testDir: './tests/web-app', use: { ...devices['iPhone 13'], baseURL: `http://localhost:${WEB_APP_PORT}` } },
    ...(process.env.SAFARI === 'all'
      ? [{ name: 'safari', testIgnore: ['android/**', 'web-app/**', 'unit/**'], use: { ...devices['iPhone 13'], baseURL: `http://localhost:${PORT}` } }]
      : []),
  ],
  webServer: [
    // The production web build, served the same way Capacitor bundles it.
    {
      command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npm run build:web && npx vite preview --outDir dist-web --port ${WEB_APP_PORT} --strictPort`,
      url: `http://localhost:${WEB_APP_PORT}`,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
