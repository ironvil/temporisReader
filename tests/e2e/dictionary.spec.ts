import { expect, test, type Page } from '@playwright/test';
import { addChinese, CEDICT_URL, chineseBook, importBook, nextPage, openFirstBook, openLanguageSettings, tapText } from './helpers';

async function start(page: Page) {
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
}

test('add Chinese in settings, then look up words', async ({ page }) => {
  await start(page);
  await addChinese(page);
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

  // Tapping either character of a word selects the whole word.
  for (const offset of [0, 1]) {
    await tapText(page, '头发', offset);
    await expect(popup.locator('.zh-hanzi')).toHaveText('头发');
    await expect(popup.locator('.zh-alt')).toHaveText('[頭髮]');
    await expect(popup.locator('.zh-pinyin')).toHaveText('tóufa');
  }

  // Three-character words and words inside longer runs.
  await tapText(page, '猫头鹰', 1);
  await expect(popup.locator('.zh-hanzi')).toHaveText('猫头鹰');
  await tapText(page, '早上', 1);
  await expect(popup.locator('.zh-hanzi')).toHaveText('早上');

  // Tapping punctuation closes the popup.
  await tapText(page, '，');
  await expect(popup).toBeHidden();
});

test('segmentation does not depend on the browser word breaker', async ({ page }) => {
  // Android WebView's ICU has no Chinese dictionary and splits every character; simulate that.
  await page.addInitScript(() => {
    const Original = Intl.Segmenter;
    (Intl as { Segmenter: typeof Intl.Segmenter }).Segmenter = class extends Original {
      constructor(locale?: string | string[], options?: Intl.SegmenterOptions) {
        super('en', options);
        void locale;
      }
    } as typeof Intl.Segmenter;
  });
  await start(page);
  await addChinese(page);
  await importBook(page, 'book.txt', chineseBook());
  await openFirstBook(page);
  await tapText(page, '头发', 1);
  await expect(page.locator('.lookup-popup .zh-hanzi')).toHaveText('头发');
});

test('lookups work inside bold and italic text', async ({ page }) => {
  await start(page);
  await addChinese(page);
  await importBook(page, 'styled.md', '# 书\n\n她的**头发**是*白金*的。\n');
  await openFirstBook(page);
  await tapText(page, '头发', 1);
  await expect(page.locator('.lookup-popup .zh-hanzi')).toHaveText('头发');
  await tapText(page, '白金', 1);
  await expect(page.locator('.lookup-popup .zh-pinyin')).toHaveText('báijīn');
});

test('long entries scroll inside the popup instead of overflowing', async ({ page }) => {
  await start(page);
  await addChinese(page);
  await importBook(page, 'le.txt', '第一章\n她来了。\n');
  await openFirstBook(page);
  await tapText(page, '了');
  const popup = page.locator('.lookup-popup');
  await expect(popup.locator('.defs li')).toHaveCount(30);

  const geometry = await page.evaluate(() => {
    const wrap = document.querySelector('.page-wrap')!.getBoundingClientRect();
    const box = document.querySelector('.lookup-popup')!.getBoundingClientRect();
    const body = document.querySelector('.lookup-body')!;
    const last = document.querySelector('.defs li:last-child')!.getBoundingClientRect();
    return { wrapTop: wrap.top, wrapBottom: wrap.bottom, top: box.top, bottom: box.bottom, scrollable: body.scrollHeight > body.clientHeight, lastBottom: last.bottom };
  });
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.wrapTop);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.wrapBottom);
  expect(geometry.scrollable).toBe(true);
  expect(geometry.lastBottom).toBeGreaterThan(geometry.bottom); // hidden below, reachable by scrolling
});

test('popup points at the word', async ({ page }) => {
  await start(page);
  await addChinese(page);
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
  await addChinese(page);
  await importBook(page, 'book.txt', chineseBook());
  await openFirstBook(page);
  const popup = page.locator('.lookup-popup');

  await tapText(page, '今天');
  await expect(popup).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();

  await tapText(page, '今天');
  await expect(popup).toBeVisible();
  await nextPage(page);
  await expect(popup).toBeHidden();
});

test('lookup before adding the language points to settings', async ({ page }) => {
  await start(page);
  await importBook(page, 'book.txt', chineseBook());
  await openFirstBook(page);
  await tapText(page, '阳光');
  const popup = page.locator('.lookup-popup');
  await expect(popup).toContainText('Chinese isn’t added yet');
  await popup.getByRole('button', { name: 'Open settings' }).click();
  await expect(page.locator('[data-language="zh"] .lang-status')).toHaveText('Not added · 4 MB download');
});

test('failed download is reported and nothing is installed', async ({ page }) => {
  await start(page);
  await page.route(CEDICT_URL, (route) => route.fulfill({ status: 500, body: 'nope', headers: { 'access-control-allow-origin': '*' } }));
  await openLanguageSettings(page, 'zh');
  await page.locator('[data-language="zh"]').getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('[data-language="zh"] .lang-status')).toHaveText(/^Not added · 4 MB download · Download failed/);
});

test('rejects a download that is not CC-CEDICT', async ({ page }) => {
  await start(page);
  await page.route(CEDICT_URL, (route) =>
    route.fulfill({ status: 200, body: '<html>captive portal</html>', headers: { 'access-control-allow-origin': '*' } }),
  );
  await openLanguageSettings(page, 'zh');
  await page.locator('[data-language="zh"]').getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('[data-language="zh"] .lang-status')).toContainText('does not look like CC-CEDICT');
});

test('added language survives restart and can be removed', async ({ page }) => {
  await start(page);
  await addChinese(page);
  await page.reload();
  await expect(page.locator('body[data-ready]')).toBeAttached();

  await importBook(page, 'book.txt', chineseBook());
  await openFirstBook(page);
  await tapText(page, '今天');
  await expect(page.locator('.zh-pinyin')).toHaveText('jīntiān');

  await openLanguageSettings(page, 'zh');
  const card = page.locator('[data-language="zh"]');
  await expect(card.locator('[data-dictionary="cc-cedict"] .dict-status')).toHaveText(/^1,1\d\d entries · 2026-11-01$/);
  page.once('dialog', (d) => d.accept());
  await card.getByRole('button', { name: 'Remove' }).click();
  await expect(card.locator('.lang-status')).toHaveText('Not added · 4 MB download');
});

test('tapping anywhere outside the open popup only closes it', async ({ page }) => {
  await start(page);
  await addChinese(page);
  await importBook(page, 'book.txt', chineseBook());
  await openFirstBook(page);
  const popup = page.locator('.lookup-popup');
  const lookups = page.locator('.lookup-popup .zh-hanzi');

  // Tapping another word closes the popup instead of looking the word up.
  await tapText(page, '今天');
  await expect(lookups).toHaveText('今天');
  const word = await page.evaluate(() => {
    // Centre of the first character of 头发 that the popup doesn't cover.
    for (const block of document.querySelectorAll<HTMLElement>('.page-flow [data-block]')) {
      const node = [...block.childNodes].find((n) => n.textContent?.includes('头发'));
      if (!(node instanceof Text)) continue;
      const range = document.createRange();
      const at = node.data.indexOf('头发');
      range.setStart(node, at);
      range.setEnd(node, at + 1);
      const r = range.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (block.contains(document.elementFromPoint(x, y))) return { x, y };
    }
    return null;
  });
  expect(word).not.toBeNull();
  await page.mouse.click(word!.x, word!.y);
  await expect(popup).toBeHidden();
  // A second tap on the same spot does look it up.
  await page.mouse.click(word!.x, word!.y);
  await expect(lookups).toHaveText('头发');

  // Tapping inside the popup keeps it open.
  await popup.locator('.lookup-body').click();
  await expect(popup).toBeVisible();

  // The header and footer close it too, and their buttons still work.
  await page.locator('.reader .bar-title').click();
  await expect(popup).toBeHidden();
  await tapText(page, '今天');
  await page.locator('.page-indicator').click();
  await expect(popup).toBeHidden();
  await expect(page.locator('.scrubber')).toBeVisible();
});
