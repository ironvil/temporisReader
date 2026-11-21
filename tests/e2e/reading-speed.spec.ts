/**
 * Reading speed (src/reader/reading-speed.ts): pages read for 10 seconds or more become samples;
 * once there are enough, the language's settings show words per minute and the reader shows the
 * time left in the chapter and the book. Time is controlled with Playwright's fake clock.
 */
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { addChinese, chineseBook, closeSettings, importBook, nextPage, openFirstBook, openLanguageSettings, withStorage } from './helpers';

interface Sample {
  at: number;
  chars: number;
  words: number | null;
  ms: number;
}

const samples = (page: Page) =>
  withStorage(
    page,
    async (s) => {
      const entry = await s.get('/DATA/reading-speed/zh.json');
      return entry ? (JSON.parse(entry.content).pages as Sample[]) : [];
    },
    null,
  );

const dwell = (page: Page, ms: number) => page.clock.fastForward(ms);

/** Pretends the app went to the background (or came back), as switching apps does. */
const setHidden = (page: Page, hidden: boolean) =>
  page.evaluate((hidden) => {
    Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);

test('pages read become a reading speed, shown in settings and as time left in the reader', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-10T09:00:00') });
  await page.clock.pauseAt(new Date('2026-11-10T09:00:01'));
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await addChinese(page);
  // The mark-known prompt would come up on every page turned.
  await page.locator('.view:not([hidden])').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByText('Offer to mark words I didn’t look up as known').click();
  await closeSettings(page);
  // One long chapter, then a short one.
  const long = chineseBook().split('\n');
  await importBook(page, 'speed.md', ['第一章', ...Array.from({ length: 8 }, () => long.slice(1, 41)).flat(), '第二章', '她对镜子说。'].join('\n'));
  await openFirstBook(page);

  const chapterLeft = page.locator('[data-time-left="chapter"]');
  const bookLeft = page.locator('[data-time-left="book"]');
  await expect(chapterLeft).toHaveClass(/empty/);

  // Too quick to count: turning pages to find a place.
  for (let i = 0; i < 3; i++) {
    await dwell(page, 2_000);
    await nextPage(page);
  }
  expect(await samples(page)).toEqual([]);

  // Ten pages read at a steady pace: enough for a speed.
  for (let i = 0; i < 10; i++) {
    await dwell(page, 30_000);
    await nextPage(page);
  }
  await expect.poll(async () => (await samples(page)).length).toBe(10);
  const read = await samples(page);
  expect(read.every((s) => s.ms === 30_000 && s.chars > 0 && s.words! > 0)).toBe(true);

  await expect(chapterLeft).not.toHaveClass(/empty/);
  await expect(chapterLeft).toContainText(/^\d+ min|^<1 min/);
  await expect(chapterLeft).toContainText('left in chapter');
  await expect(bookLeft).toContainText('left in book');

  // Time in the background doesn't count: 10 s, 5 min away, 10 s more is a 20 s page.
  await dwell(page, 10_000);
  await setHidden(page, true);
  await dwell(page, 5 * 60_000);
  await setHidden(page, false);
  await dwell(page, 10_000);
  await nextPage(page);
  await expect.poll(async () => (await samples(page)).at(-1)?.ms).toBe(20_000);

  // Settings show words per minute from the stored pages (all equally recent here).
  const all = await samples(page);
  const words = all.reduce((n, s) => n + s.words!, 0);
  const ms = all.reduce((n, s) => n + s.ms, 0);
  await openLanguageSettings(page, 'zh');
  const row = page.locator('[data-reading-speed="zh"]');
  await expect(row).toContainText(`${Math.round((words / ms) * 60_000)} words per minute · from 11 pages`);

  await page.once('dialog', (d) => d.accept());
  await row.getByRole('button', { name: 'Reset' }).click();
  await expect(row).toContainText('Not enough reading yet: 0 of 10 pages');
  await expect.poll(() => samples(page)).toEqual([]);
  await closeSettings(page);
  await expect(chapterLeft).toHaveClass(/empty/);
});

test('reading speed is in the backup and comes back with it', async ({ page }) => {
  const pages = Array.from({ length: 12 }, (_, i) => ({ at: Date.now() - i * 60_000, chars: 300, words: 200, ms: 60_000 }));
  const backup = {
    app: 'temporis-reader',
    backupVersion: 1,
    createdAt: new Date().toISOString(),
    appVersion: '0.21.0',
    settings: {},
    library: [],
    files: {},
    knownWords: {},
    readingSpeed: { zh: JSON.stringify({ version: 1, pages }) },
  };
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await page.locator('.view.library').getByRole('button', { name: 'Settings', exact: true }).click();
  const confirmation = page.waitForEvent('dialog');
  await page.getByTestId('restore-input').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await (await confirmation).accept();
  await page.waitForEvent('load');
  await expect(page.locator('body[data-ready]')).toBeAttached();

  await openLanguageSettings(page, 'zh');
  await expect(page.locator('[data-reading-speed="zh"]')).toContainText('200 words per minute · from 12 pages');

  await page.getByRole('button', { name: 'Back to settings' }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Back up library' }).click();
  const text = await readFile((await (await pending).path())!, 'utf8');
  expect(JSON.parse(JSON.parse(text).readingSpeed.zh).pages).toEqual(pages);
});
