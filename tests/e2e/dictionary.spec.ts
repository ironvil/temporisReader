import { expect, test, type Page } from '@playwright/test';
import { CEDICT_URL, chineseBook, fakeCedict, importBook, openFirstBook, tapText } from './helpers';

async function start(page: Page) {
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
}

async function installDictionary(page: Page) {
  await page.route(CEDICT_URL, (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-gzip', body: fakeCedict(), headers: { 'access-control-allow-origin': '*' } }),
  );
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const card = page.locator('[data-dictionary="cc-cedict"]');
  await expect(card.locator('.dict-status')).toHaveText(/^Installed · 1,106 entries · 2026-11-01/);
  await page.getByRole('button', { name: 'Close settings' }).click();
}

test('download from the first-run banner, then look up words', async ({ page }) => {
  await start(page);
  await installDictionary(page);
  await importBook(page, 'book.txt', chineseBook());
  await openFirstBook(page);

  const popup = page.locator('.lookup-popup');
  await tapText(page, '在光里');
  await expect(popup).toBeVisible();
  await expect(popup.locator('.zh-hanzi')).toHaveText('在');
  await expect(popup.locator('.zh-hanzi .tone-4')).toHaveText('在');
  await expect(popup.locator('.zh-pinyin')).toHaveText('zài');
  await expect(popup.locator('.defs li')).toHaveText([
    'to exist; to be alive',
    '(of sb or sth) to be (located) at',
    '(used before a verb to indicate an action in progress)',
  ]);
  await expect(popup.locator('.lookup-badge')).toHaveText('CC');

  // Tapping the second character of a word selects the whole word.
  await tapText(page, '头发', 1);
  await expect(popup.locator('.zh-hanzi')).toHaveText('头发');
  await expect(popup.locator('.zh-alt')).toHaveText('[頭髮]');
  await expect(popup.locator('.zh-pinyin')).toHaveText('tóufa');

  // Tapping punctuation closes the popup.
  await tapText(page, '，');
  await expect(popup).toBeHidden();
});

test('popup points at the word', async ({ page }) => {
  await start(page);
  await installDictionary(page);
  await importBook(page, 'book.txt', chineseBook());
  await openFirstBook(page);

  await tapText(page, '阳光');
  const popup = page.locator('.lookup-popup');
  await expect(popup.locator('.zh-pinyin')).toHaveText('yángguāng');
  const side = await popup.getAttribute('data-side');
  const geometry = await page.evaluate(() => {
    const arrow = document.querySelector('.lookup-arrow')!.getBoundingClientRect();
    const box = document.querySelector('.lookup-popup')!.getBoundingClientRect();
    return { arrowX: arrow.left + arrow.width / 2, top: box.top, bottom: box.bottom };
  });
  const word = await page.evaluate(() => {
    for (const b of document.querySelectorAll('.page-flow [data-block]')) {
      const t = b.firstChild as Text;
      const i = t.data.indexOf('阳光');
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(t, i);
      r.setEnd(t, i + 2);
      const rect = r.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom };
    }
    return null;
  });
  expect(Math.abs(geometry.arrowX - word!.x)).toBeLessThan(4);
  if (side === 'below') expect(geometry.top).toBeGreaterThan(word!.bottom);
  else expect(geometry.bottom).toBeLessThan(word!.top);
});

test('popup closes on page turn and on Escape', async ({ page }) => {
  await start(page);
  await installDictionary(page);
  await importBook(page, 'book.txt', chineseBook());
  await openFirstBook(page);
  const popup = page.locator('.lookup-popup');

  await tapText(page, '今天');
  await expect(popup).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();

  await tapText(page, '今天');
  await expect(popup).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(popup).toBeHidden();
});

test('lookup without a dictionary points to settings', async ({ page }) => {
  await start(page);
  await importBook(page, 'book.txt', chineseBook());
  await openFirstBook(page);
  await tapText(page, '阳光');
  const popup = page.locator('.lookup-popup');
  await expect(popup).toContainText('dictionary isn’t downloaded yet');
  await popup.getByRole('button', { name: 'Open settings' }).click();
  await expect(page.locator('[data-dictionary="cc-cedict"] .dict-status')).toHaveText(/^Not downloaded/);
});

test('failed download is reported and nothing is installed', async ({ page }) => {
  await start(page);
  await page.route(CEDICT_URL, (route) => route.fulfill({ status: 500, body: 'nope', headers: { 'access-control-allow-origin': '*' } }));
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.locator('[data-dictionary="cc-cedict"] .dict-status')).toHaveText(/^Not downloaded · 4 MB · Last attempt failed/);
});

test('rejects a download that is not CC-CEDICT', async ({ page }) => {
  await start(page);
  await page.route(CEDICT_URL, (route) =>
    route.fulfill({ status: 200, body: '<html>captive portal</html>', headers: { 'access-control-allow-origin': '*' } }),
  );
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.locator('[data-dictionary="cc-cedict"] .dict-status')).toContainText('does not look like CC-CEDICT');
});

test('dictionary survives restart and can be deleted', async ({ page }) => {
  await start(page);
  await installDictionary(page);
  await page.reload();
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await expect(page.getByText('Download the Chinese dictionary?')).toBeHidden();

  await importBook(page, 'book.txt', chineseBook());
  await openFirstBook(page);
  await tapText(page, '今天');
  await expect(page.locator('.zh-pinyin')).toHaveText('jīntiān');

  await page.getByRole('button', { name: 'Settings' }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('[data-dictionary="cc-cedict"] .dict-status')).toHaveText(/^Not downloaded/);
});
