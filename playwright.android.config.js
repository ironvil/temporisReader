import { defineConfig } from '@playwright/test';

// Android tests: the debug APK on an emulator, driven through its WebView and the system UI.
// Run with `npm run test:android` (scripts/android-test.mjs), which starts the emulator and builds the APK.
export default defineConfig({
  testDir: './tests/android',
  // One emulator, one app: tests can't overlap.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000, // each takes seconds: anything longer has hung
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: 'list',
});
