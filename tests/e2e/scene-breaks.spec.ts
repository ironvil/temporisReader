/**
 * Scene breaks at page edges. A break isn't text: content.txt, offsets, progress and the scrubber
 * know nothing of it, while the page shows `* * *` above the paragraph after it. These check that
 * the two agree where it matters most: a page that starts with a break, and the page before it.
 */
import { expect, test, type Page } from '@playwright/test';
import { addChinese, importBook, nextPage, openFirstBook, pageIndicator, settled } from './helpers';

const SETTLE = 1_000;

/** Two chapters of one-line paragraphs with a break before each: page edges fall at breaks. */
const CHAPTERS = [40, 25].map((n, c) => Array.from({ length: n }, (_, p) => `〔${c + 1}-${p + 1}〕她下楼了。`));
const markdown = CHAPTERS.map((paragraphs, c) => `# 第${'一二'[c]}章\n\n${paragraphs.join('\n\n---\n\n')}`).join('\n\n');
/** The book's text as stored: headings and paragraphs, no breaks. */
const content = CHAPTERS.flatMap((paragraphs, c) => [`第${'一二'[c]}章`, ...paragraphs]).join('\n');
const offsetOf = (tag: string) => {
  const at = content.indexOf(tag);
  if (at < 0) throw new Error(`No ${tag}`);
  return at;
};

/** What the current page shows: its first and last paragraph, and whether it opens with a break. */
function onPage(page: Page) {
  return page.evaluate(() => {
    const area = document.querySelector('.page-area')!.getBoundingClientRect();
    const inPage = (r: DOMRect) => r.width > 0 && r.left >= area.left - 1 && r.right <= area.right + 1;
    const shown = [...document.querySelectorAll<HTMLElement>('.page-flow p')].filter((p) => {
      const range = document.createRange();
      range.selectNodeContents(p);
      return [...range.getClientRects()].some(inPage);
    });
    const first = shown[0];
    const range = document.createRange();
    range.selectNodeContents(first);
    return {
      first: first.textContent!,
      last: shown.at(-1)!.textContent!,
      // Its asterisks are on this page, above its text.
      opensWithBreak: first.classList.contains('new-scene') && inPage(first.getClientRects()[0]) && first.getClientRects()[0].top < range.getClientRects()[0].top,
    };
  });
}

async function setUp(page: Page): Promise<void> {
  await page.clock.install({ time: new Date('2026-11-10T09:00:00') });
  await page.clock.pauseAt(new Date('2026-11-10T09:00:01'));
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await importBook(page, 'breaks.md', markdown);
  await openFirstBook(page);
}

async function scrubTo(page: Page, offset: number): Promise<void> {
  await page.getByRole('button', { name: 'Book position' }).click();
  await page.getByRole('slider', { name: 'Position in book' }).evaluate((input: HTMLInputElement, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, offset);
  await page.clock.fastForward(SETTLE);
  await page.keyboard.press('Escape');
  await settled(page);
}

async function reload(page: Page): Promise<void> {
  // Closing the book saves its place; wait for that before reloading.
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page.locator('.book-details').first()).not.toHaveText(/^Not started/);
  await page.reload();
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await openFirstBook(page);
  await settled(page);
}

test('every page starts at a break and ends just before one', async ({ page }) => {
  await setUp(page);
  const { total } = await pageIndicator(page);
  expect(total).toBeGreaterThan(3);
  let previousLast = '';
  for (let n = 1; n <= total; n++) {
    const shown = await onPage(page);
    if (n > 1) {
      expect(shown.opensWithBreak, `page ${n}`).toBe(true);
      // Nothing skipped or shown twice between pages.
      const [, c, p] = /〔(\d)-(\d+)〕/.exec(previousLast)!;
      expect(shown.first, `page ${n}`).toBe(`〔${c}-${Number(p) + 1}〕她下楼了。`);
    }
    previousLast = shown.last;
    if (n < total) {
      await nextPage(page);
      await settled(page);
    }
  }
  expect(previousLast).toBe('〔1-40〕她下楼了。');
});

test.describe('the first paragraph of a page (just after a break)', () => {
  test('reopening comes back to the same page, with the break at its top', async ({ page }) => {
    await setUp(page);
    await nextPage(page, 2);
    await settled(page);
    const at = await pageIndicator(page);
    const shown = await onPage(page);
    expect(shown.opensWithBreak).toBe(true);
    await reload(page);
    expect(await pageIndicator(page)).toEqual(at);
    expect(await onPage(page)).toEqual(shown);
  });

  test('scrubbing to its first character lands on that page, not the one before', async ({ page }) => {
    await setUp(page);
    await nextPage(page, 2);
    await settled(page);
    const target = await onPage(page);
    const at = await pageIndicator(page);
    await nextPage(page, 2);
    await scrubTo(page, offsetOf(target.first));
    expect(await pageIndicator(page)).toEqual(at);
    expect(await onPage(page)).toEqual(target);
    await reload(page);
    expect(await pageIndicator(page)).toEqual(at);
  });
});

test.describe('the last paragraph of a page (just before a break)', () => {
  test('scrubbing to its last character lands on that page, not the next', async ({ page }) => {
    await setUp(page);
    await nextPage(page, 1);
    await settled(page);
    const target = await onPage(page);
    const at = await pageIndicator(page);
    await nextPage(page, 2);
    await scrubTo(page, offsetOf(target.last) + target.last.length - 1);
    expect(await pageIndicator(page)).toEqual(at);
    expect(await onPage(page)).toEqual(target);
    // Saved there: reopening shows the same page.
    await reload(page);
    expect(await pageIndicator(page)).toEqual(at);
    expect(await onPage(page)).toEqual(target);
  });

  test('scrubbing to the newline after it goes to the same page', async ({ page }) => {
    await setUp(page);
    await nextPage(page, 1);
    await settled(page);
    const target = await onPage(page);
    const at = await pageIndicator(page);
    await nextPage(page, 2);
    // The offset between two paragraphs, where the break is drawn: it belongs to the one before.
    await scrubTo(page, offsetOf(target.last) + target.last.length);
    expect(await pageIndicator(page)).toEqual(at);
  });
});

test('the last page of a chapter and the first of the next', async ({ page }) => {
  await setUp(page);
  await scrubTo(page, offsetOf('〔1-40〕'));
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 1 of 2');
  const { page: last, total } = await pageIndicator(page);
  expect(last).toBe(total);
  expect((await onPage(page)).last).toBe('〔1-40〕她下楼了。');
  await nextPage(page);
  await settled(page);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 2 of 2');
  // A chapter opens with its heading, never with a break.
  await expect(page.locator('.page-flow > :first-child')).toHaveText('第二章');
  await expect(page.locator('.page-flow > :nth-child(2)')).not.toHaveClass('new-scene');
  await reload(page);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 2 of 2');
  expect((await pageIndicator(page)).page).toBe(1);
});

test('page counts are the same after reloading, and the scrubber’s estimate is close', async ({ page }) => {
  await setUp(page);
  const before = await pageIndicator(page);
  await page.getByRole('button', { name: 'Book position' }).click();
  await page.getByRole('slider', { name: 'Position in book' }).evaluate((input: HTMLInputElement, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, offsetOf('〔1-30〕'));
  const estimate = Number((await page.locator('.scrub-detail').textContent())!.match(/of ≈(\d+)/)![1]);
  // Breaks take room but aren't text: the estimate comes from this chapter's own pages.
  expect(Math.abs(estimate - before.total)).toBeLessThanOrEqual(Math.ceil(before.total * 0.2));
  await page.keyboard.press('Escape');
  await reload(page);
  expect((await pageIndicator(page)).total).toBe(before.total);
});

test('reading progress and known words count the text, not the breaks', async ({ page }) => {
  await setUp(page);
  await addChinese(page);
  // The same text without breaks, for comparison (a .txt finds the same chapters and paragraphs).
  await page.getByRole('button', { name: 'Library' }).click();
  await importBook(page, 'plain.txt', content);
  const book = (name: string) => page.locator('.book-open', { hasText: name });
  const known = (name: string) => book(name).locator('.book-known');
  const read = async (name: string) => (await book(name).locator('.book-details').textContent())!.split(' · ')[0];
  // Counting runs on timers, which this test's paused clock holds: move it on until both are done.
  const counted = async () => {
    await expect(async () => {
      await page.clock.fastForward(500);
      expect(await page.locator('.book-known').allTextContents()).toEqual([expect.stringMatching(/% of words known/), expect.stringMatching(/% of words known/)]);
    }).toPass();
  };
  await counted();
  const share = await known('第一章').textContent();
  expect(await known('plain').textContent()).toBe(share);

  // The same place in the text is the same percentage read.
  for (const name of ['第一章', 'plain']) {
    await book(name).click();
    await expect(page.locator('.page-count')).toBeVisible();
    await scrubTo(page, offsetOf('〔1-30〕'));
    await page.getByRole('button', { name: 'Library' }).click();
    await expect(book(name).locator('.book-details')).not.toHaveText(/^Not started/);
  }
  const percent = await read('第一章');
  expect(percent).toMatch(/^\d+%$/);
  expect(percent).toBe(`${Math.round((offsetOf('〔1-30〕') / content.length) * 100)}%`);
  expect(await read('plain')).toBe(percent);
  await page.reload();
  await expect(page.locator('body[data-ready]')).toBeAttached();
  expect(await read('第一章')).toBe(percent);
  await counted();
  expect(await known('第一章').textContent()).toBe(share);
  expect(await known('plain').textContent()).toBe(share);
});
