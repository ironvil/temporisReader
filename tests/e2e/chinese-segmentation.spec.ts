/**
 * Chinese word splitting is chosen in Settings → Languages → Chinese (src/languages/zh/segmenters.ts).
 * The engines are tested in tests/unit/chinese-segmentation.spec.ts; this checks the app's side:
 * the bundled jieba data loads, the setting shows and is kept, and the reader follows it.
 */
import { expect, test } from '@playwright/test';
import { addChinese, closeSettings, importBook, openFirstBook, openLanguageSettings, tapText } from './helpers';

test('word splitting follows the setting', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await addChinese(page);
  await importBook(page, 'split.txt', '他说的确实在理。\n'.repeat(3));
  await openFirstBook(page);
  const popup = page.locator('.lookup-popup');

  // The default: most likely words + names, from jieba's word counts (bundled with the app).
  await tapText(page, '确');
  await expect(popup.locator('.zh-hanzi')).toHaveText('确实');

  await openLanguageSettings(page, 'zh');
  const card = page.locator('[data-language="zh"]');
  const splitting = card.getByLabel('Word splitting');
  await expect(splitting).toHaveValue('frequency-names');
  await expect(splitting.locator('option')).toHaveText(['Most likely words + names', 'Most likely words', 'Fewest words']);
  await splitting.selectOption({ label: 'Fewest words' });
  await expect(card.getByText('Splits text into as few dictionary words as possible (how earlier versions split).')).toBeVisible();
  await closeSettings(page);

  await tapText(page, '确');
  await expect(popup.locator('.zh-hanzi')).toHaveText('的确');

  // Kept after a restart.
  await page.reload();
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await openLanguageSettings(page, 'zh');
  await expect(page.locator('[data-language="zh"]').getByLabel('Word splitting')).toHaveValue('fewest-words');
});
