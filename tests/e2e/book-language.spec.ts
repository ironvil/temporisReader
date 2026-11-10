/** Book language (one per book, editable) and the reminders shown when a book is opened. */
import { expect, test, type Page } from '@playwright/test';
import { addChinese, chineseBook, importBook, tapText } from './helpers';

const addReminder = (page: Page) => page.getByRole('dialog', { name: 'Add Chinese?' });
const unsupportedNotice = (page: Page) => page.getByRole('dialog', { name: 'Lookups aren’t available' });

async function openBook(page: Page, title: string) {
  await page.locator('.book-open', { hasText: title }).click();
  await expect(page.locator('.book-title')).toHaveText(title);
  await expect(page.locator('.reader[data-language-check="done"]')).toBeAttached();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
});

test('opening a Chinese book before adding Chinese reminds you, every time', async ({ page }) => {
  await importBook(page, 'owl.txt', chineseBook());
  await openBook(page, 'owl');
  await expect(addReminder(page)).toBeVisible();
  await expect(addReminder(page)).toContainText('This book is in Chinese, but Chinese hasn’t been added yet.');

  // "Not now" lets you keep reading.
  await addReminder(page).getByRole('button', { name: 'Not now' }).click();
  await expect(addReminder(page)).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.page-count')).toHaveText(/^2 \//);

  // Shown again next time the book opens.
  await page.getByRole('button', { name: 'Library' }).click();
  await openBook(page, 'owl');
  await expect(addReminder(page)).toBeVisible();
});

test('"Open settings" goes to that language in Settings → Languages', async ({ page }) => {
  await importBook(page, 'owl.txt', chineseBook());
  await openBook(page, 'owl');
  await addReminder(page).getByRole('button', { name: 'Open settings' }).click();
  const card = page.locator('[data-language="zh"]');
  await expect(card).toBeInViewport();
  await expect(card).toHaveClass(/focus-flash/);
  await expect(card.locator('.lang-status')).toHaveText(/^Not added/);
});

test('no reminder once the language is added', async ({ page }) => {
  await addChinese(page);
  await importBook(page, 'owl.txt', chineseBook());
  await openBook(page, 'owl');
  await expect(page.locator('.page-count')).toHaveText(/^1 \//);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a book in an unsupported language gets a notice that offers to change the language', async ({ page }) => {
  await importBook(page, 'english.txt', 'It was a bright cold day in April, and the clocks were striking thirteen.');
  await expect(page.locator('.book-details')).toHaveText('Not started · 1 chapter · Unsupported language');
  await openBook(page, 'english');
  await expect(unsupportedNotice(page)).toBeVisible();

  await unsupportedNotice(page).getByRole('button', { name: 'Change language' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit book' });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Language')).toHaveValue('');
});

test('the language can be changed in the editor and is kept when chapters are added', async ({ page }) => {
  await addChinese(page);
  await importBook(page, 'owl.txt', chineseBook());
  await expect(page.locator('.book-details')).toHaveText('Not started · 2 chapters · Chinese');

  await page.getByRole('button', { name: 'Edit owl' }).click();
  const language = page.getByRole('dialog', { name: 'Edit book' }).getByLabel('Language');
  await expect(language).toHaveValue('zh');
  await expect(language.locator('option')).toHaveText(['Chinese · 中文', 'Other (not supported)']);
  await language.selectOption('');

  // Adding Chinese text would re-detect Chinese, but the choice sticks.
  await page.getByRole('button', { name: 'Add chapter' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add chapter' });
  await dialog.getByLabel('Chapter text').fill('更多的中文内容。');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog).toBeHidden();
  await expect(language).toHaveValue('');
  await page.getByRole('button', { name: 'Close editor' }).click();
  await expect(page.locator('.book-details')).toHaveText('Not started · 3 chapters · Unsupported language');

  // With no language, words can't be looked up.
  await openBook(page, 'owl');
  await unsupportedNotice(page).getByRole('button', { name: 'Not now' }).click();
  await tapText(page, '阳光');
  await expect(page.locator('.lookup-popup')).toBeHidden();

  // Back to Chinese: lookups work again.
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Edit owl' }).click();
  await page.getByRole('dialog', { name: 'Edit book' }).getByLabel('Language').selectOption('zh');
  await page.getByRole('button', { name: 'Close editor' }).click();
  await expect(page.locator('.book-details')).toHaveText(/ · 3 chapters · Chinese$/); // opened once: shows progress now
  await openBook(page, 'owl');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await tapText(page, '阳光');
  await expect(page.locator('.lookup-popup .zh-pinyin')).toHaveText('yángguāng');
});

test('setting the language of an unsupported book to Chinese leads to the add reminder', async ({ page }) => {
  await importBook(page, 'mixed.txt', 'Hello there. Mostly English text with 一点 Chinese.');
  await page.getByRole('button', { name: 'Edit mixed' }).click();
  await page.getByRole('dialog', { name: 'Edit book' }).getByLabel('Language').selectOption('zh');
  await page.getByRole('button', { name: 'Close editor' }).click();
  await openBook(page, 'mixed');
  await expect(addReminder(page)).toBeVisible();
});
