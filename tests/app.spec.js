import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('shows hello world on the web platform', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Hello, Capacitor/);
  await expect(page.locator('#platform')).toHaveText('Running on: web');
});

test('reads a file chosen with the file picker', async ({ page }) => {
  const contents = 'Chapter 1\nIt was a bright cold day in April.\n';
  await page.locator('#picker').setInputFiles({
    name: 'book.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(contents),
  });

  await expect(page.locator('#file-meta')).toHaveText(
    `book.txt · text/plain · ${Buffer.byteLength(contents)} bytes`,
  );
  await expect(page.locator('#output')).toHaveText(contents);
});

test('truncates very large files in the preview', async ({ page }) => {
  await page.locator('#picker').setInputFiles({
    name: 'big.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('a'.repeat(250_000)),
  });

  await expect(page.locator('#output')).toContainText('… (truncated)');
});

test('reading app storage before writing reports an error', async ({ page }) => {
  await page.getByRole('button', { name: 'Read hello.txt' }).click();
  await expect(page.locator('#fs-status')).toContainText('Read failed');
});

test('writes and reads back hello.txt via the Filesystem plugin', async ({ page }) => {
  await page.getByRole('button', { name: 'Write hello.txt' }).click();
  await expect(page.locator('#fs-status')).toContainText('Wrote');

  await page.getByRole('button', { name: 'Read hello.txt' }).click();
  await expect(page.locator('#fs-status')).toHaveText('Read hello.txt');
  await expect(page.locator('#output')).toContainText('Hello from Temporis Reader!');
});
