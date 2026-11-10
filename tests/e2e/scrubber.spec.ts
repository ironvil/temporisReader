/**
 * Book scrubber: tap the footer, drag through the whole book, and the reader jumps once the
 * thumb has been still for SCRUB_SETTLE_MS (1 s). Time is controlled with a paused fake clock.
 */
import { expect, test, type Page } from '@playwright/test';
import { addChinese, importBook, nextPage, openFirstBook, tapText } from './helpers';

const SETTLE = 1_000;

/** Five chapters of different lengths; every paragraph is unique so positions can be checked. */
function book(): string {
  const chapters: string[] = [];
  const sizes = [30, 5, 60, 1, 20];
  sizes.forEach((n, c) => {
    chapters.push(`第${'一二三四五'[c]}章`);
    for (let p = 0; p < n; p++) chapters.push(`〔${c + 1}-${p + 1}〕今天早上，阳光从高高的窗户里斜斜地照进来。`);
  });
  return chapters.join('\n');
}

const scrubber = (page: Page) => page.getByRole('group', { name: 'Book position' });
const range = (page: Page) => page.getByRole('slider', { name: 'Position in book' });

async function setUp(page: Page) {
  await page.clock.install({ time: new Date('2026-11-10T09:00:00') });
  await page.clock.pauseAt(new Date('2026-11-10T09:00:01'));
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await importBook(page, 'scrub.txt', book());
  await openFirstBook(page);
}

/** Drags the thumb to a character offset (input events, like a finger moving). */
async function dragTo(page: Page, offset: number) {
  await range(page).evaluate((input: HTMLInputElement, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, offset);
}

/** Global offset where the text `needle` starts in the book content. */
const offsetOf = (needle: string) => book().split('\n').join('\n').indexOf(needle);

/** Paragraph (data-block) visible on screen that contains `needle`, if any. */
const visible = (page: Page, needle: string) =>
  page.evaluate((needle) => {
    const area = document.querySelector('.page-area')!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>('.page-flow [data-block]')].some(
      (b) => b.textContent!.includes(needle) && [...b.getClientRects()].some((r) => r.left >= area.left && r.left < area.right),
    );
  }, needle);

test('tapping the footer opens and closes the scrubber with chapter-break ticks', async ({ page }) => {
  await setUp(page);
  await expect(scrubber(page)).toBeHidden();
  await page.getByRole('button', { name: 'Book position' }).click();
  await expect(scrubber(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Book position' })).toHaveAttribute('aria-expanded', 'true');

  // One tick per chapter break, at the chapter's share of the book.
  const ticks = await page.locator('.scrub-tick').evaluateAll((els) => els.map((e) => parseFloat((e as HTMLElement).style.left)));
  const total = book().length;
  const expected = ['第二章\n', '第三章\n', '第四章\n', '第五章\n'].map((h) => (offsetOf(h) / total) * 100);
  expect(ticks).toHaveLength(4);
  ticks.forEach((t, i) => expect(t).toBeCloseTo(expected[i], 2));

  await expect(page.locator('.scrub-label')).toHaveText('Chapter 1 of 5 · 第一章');
  await expect(page.locator('.scrub-detail')).toHaveText(/^Page 1 of \d+ · 0%$/);
  expect(Number(await range(page).inputValue())).toBe(0);

  await page.getByRole('button', { name: 'Book position' }).click();
  await expect(scrubber(page)).toBeHidden();
});

test('dragging only estimates; the jump happens after the thumb settles for a second', async ({ page }) => {
  await setUp(page);
  await page.getByRole('button', { name: 'Book position' }).click();
  const target = offsetOf('〔3-30〕');
  await dragTo(page, target);

  // Label updates immediately with an estimate…
  await expect(page.locator('.scrub-label')).toHaveText('Chapter 3 of 5 · 第三章');
  await expect(page.locator('.scrub-detail')).toHaveText(/^Page ≈\d+ of ≈\d+ · \d+%$/);
  // …but the reader hasn't moved.
  await page.clock.fastForward(SETTLE - 100);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 1 of 5');

  await page.clock.fastForward(100);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 3 of 5');
  expect(await visible(page, '〔3-30〕')).toBe(true);
  // Now exact again.
  await expect(page.locator('.scrub-detail')).toHaveText(/^Page \d+ of \d+ · \d+%$/);
});

test('moving again before it settles restarts the wait and only the last position counts', async ({ page }) => {
  await setUp(page);
  await page.getByRole('button', { name: 'Book position' }).click();
  await dragTo(page, offsetOf('〔3-10〕'));
  await page.clock.fastForward(750);
  await dragTo(page, offsetOf('〔5-10〕'));
  await page.clock.fastForward(750); // 1.5s since the first move, 0.75s since the last
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 1 of 5');
  await page.clock.fastForward(250);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 5 of 5');
  expect(await visible(page, '〔5-10〕')).toBe(true);
});

test('estimated page count is close to the real pagination', async ({ page }) => {
  await setUp(page);
  await page.getByRole('button', { name: 'Book position' }).click();
  const target = offsetOf('〔3-60〕');
  await dragTo(page, target);
  const estimate = Number((await page.locator('.scrub-detail').textContent())!.match(/of ≈(\d+)/)![1]);
  await page.clock.fastForward(SETTLE);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 3 of 5');
  const real = Number((await page.locator('.page-count').textContent())!.split(' / ')[1]);
  expect(Math.abs(estimate - real)).toBeLessThanOrEqual(Math.ceil(real * 0.2));
});

test('jumping within the current chapter lands on the right page', async ({ page }) => {
  await setUp(page);
  await page.getByRole('button', { name: 'Book position' }).click();
  await dragTo(page, offsetOf('〔1-25〕'));
  await page.clock.fastForward(SETTLE);
  expect(await visible(page, '〔1-25〕')).toBe(true);
  await expect(page.locator('.page-count')).not.toHaveText(/^1 \//);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 1 of 5');
});

test('the jump is saved as reading progress', async ({ page }) => {
  await setUp(page);
  await page.getByRole('button', { name: 'Book position' }).click();
  await dragTo(page, offsetOf('〔4-1〕'));
  await page.clock.fastForward(SETTLE);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 4 of 5');
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page.locator('.book-details')).not.toHaveText(/^Not started/);
  await page.reload();
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await openFirstBook(page);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 4 of 5');
  expect(await visible(page, '〔4-1〕')).toBe(true);
});

test('closing the scrubber with a jump pending goes there straight away', async ({ page }) => {
  await setUp(page);
  await page.getByRole('button', { name: 'Book position' }).click();
  await dragTo(page, offsetOf('〔2-3〕'));
  await page.keyboard.press('Escape');
  await expect(scrubber(page)).toBeHidden();
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 2 of 5');
});

test('turning a page cancels a pending jump', async ({ page }) => {
  await setUp(page);
  await page.getByRole('button', { name: 'Book position' }).click();
  await dragTo(page, offsetOf('〔5-1〕'));
  await page.locator('.page-area').click({ position: { x: 5, y: 5 } }); // focus away from the slider
  await nextPage(page);
  await expect(page.locator('.page-count')).toHaveText(/^2 \//);
  await page.clock.fastForward(SETTLE * 2);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 1 of 5');
  // The slider follows the page turn.
  await expect(page.locator('.scrub-label')).toHaveText('Chapter 1 of 5 · 第一章');
  await expect(page.locator('.scrub-detail')).toHaveText(/^Page 2 of \d+/);
});

test('the slider follows normal page turns', async ({ page }) => {
  await setUp(page);
  await page.getByRole('button', { name: 'Book position' }).click();
  await page.locator('.page-area').click({ position: { x: 5, y: 5 } });
  const before = Number(await range(page).inputValue());
  await nextPage(page, 2);
  await expect(page.locator('.scrub-detail')).toHaveText(/^Page 3 of/);
  expect(Number(await range(page).inputValue())).toBeGreaterThan(before);
});

test('arrow keys on the focused slider move it instead of turning pages', async ({ page }) => {
  await setUp(page);
  await page.getByRole('button', { name: 'Book position' }).click();
  await range(page).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.page-count')).toHaveText(/^1 \//);
  expect(Number(await range(page).inputValue())).toBeGreaterThan(0);
});

test('a jump never triggers the mark-known prompt', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-10T09:00:00') });
  await page.clock.pauseAt(new Date('2026-11-10T09:00:01'));
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await addChinese(page);
  await importBook(page, 'scrub.txt', book());
  await openFirstBook(page);
  await page.clock.fastForward(15_000); // long enough on page 1 to qualify for the prompt
  await page.getByRole('button', { name: 'Book position' }).click();
  await dragTo(page, offsetOf('〔3-1〕'));
  await page.clock.fastForward(SETTLE);
  await expect(page.locator('.chapter-count')).toHaveText('Chapter 3 of 5');
  await expect(page.getByRole('dialog', { name: 'Mark words as known?' })).toHaveCount(0);

  // The dwell timer restarted on arrival: an immediate page turn doesn't prompt either.
  await page.keyboard.press('Escape');
  await nextPage(page);
  await expect(page.getByRole('dialog', { name: 'Mark words as known?' })).toHaveCount(0);
});

test('Escape closes the scrubber and keeps reading (same path as the Android back button)', async ({ page }) => {
  await setUp(page);
  await page.getByRole('button', { name: 'Book position' }).click();
  await page.keyboard.press('Escape'); // same handler path as back (handleBack/Escape)
  await expect(scrubber(page)).toBeHidden();
  await expect(page.locator('.page-count')).toBeVisible(); // still reading
});

test('lookups still work with the scrubber open', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-10T09:00:00') });
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await addChinese(page);
  await importBook(page, 'scrub.txt', book());
  await openFirstBook(page);
  await page.getByRole('button', { name: 'Book position' }).click();
  await tapText(page, '阳光');
  await expect(page.locator('.lookup-popup .zh-pinyin')).toHaveText('yángguāng');
});

test('dragging through a huge single-chapter book stays cheap (no layout work per move)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body[data-ready]')).toBeAttached();
  const para = '今天早上，阳光从高高的窗户里斜斜地照进来，落在桌子上，落在银梳子上，落在她的头发上。她的头发是白金色的，长而直。';
  await importBook(page, 'huge.txt', Array.from({ length: 6000 }, () => para).join('\n')); // ~330k characters
  await openFirstBook(page);
  await page.getByRole('button', { name: 'Book position' }).click();
  const { avg, pageBefore, pageAfter } = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('.scrub-range')!;
    const pageCount = () => document.querySelector('.page-count')!.textContent;
    const pageBefore = pageCount();
    const max = Number(input.max);
    const start = performance.now();
    for (let i = 1; i <= 200; i++) {
      input.value = String(Math.round((max * i) / 201));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return { avg: (performance.now() - start) / 200, pageBefore, pageAfter: pageCount() };
  });
  expect(pageAfter).toBe(pageBefore); // no jump (and no pagination) while dragging
  expect(avg).toBeLessThan(5);
  await expect(page.locator('.scrub-detail')).toHaveText(/^Page ≈\d+ of ≈\d+ · 100%$/);
});

test.describe('looked-up words reset after a jump', () => {
  const prompt = (page: Page) => page.getByRole('dialog', { name: 'Mark words as known?' });

  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-10T09:00:00') });
    await page.clock.pauseAt(new Date('2026-11-10T09:00:01'));
    await page.goto('/');
    await expect(page.locator('body[data-ready]')).toBeAttached();
    await addChinese(page);
    await importBook(page, 'scrub.txt', book());
    await openFirstBook(page);
    await tapText(page, '今天');
    await expect(page.locator('.lookup-popup .zh-hanzi')).toHaveText('今天');
    await page.keyboard.press('Escape');
  });

  test('control: without a jump, the looked-up word is not offered', async ({ page }) => {
    await page.clock.fastForward(10_000);
    await nextPage(page);
    await expect(prompt(page).locator('.word-chip')).not.toHaveText([]);
    await expect(prompt(page).locator('.word-chip', { hasText: /^今天$/ })).toHaveCount(0);
  });

  test('a jump to a spot on the same page still clears lookups', async ({ page }) => {
    const pageBefore = await page.locator('.page-count').textContent();
    await page.getByRole('button', { name: 'Book position' }).click();
    await dragTo(page, offsetOf('〔1-2〕')); // second paragraph: still on page 1
    await page.clock.fastForward(SETTLE);
    await page.keyboard.press('Escape');
    await expect(page.locator('.page-count')).toHaveText(pageBefore!); // same page

    await page.clock.fastForward(10_000);
    await nextPage(page);
    await expect(prompt(page).locator('.word-chip', { hasText: /^今天$/ })).toHaveCount(1);
  });

  test('a jump to another chapter clears lookups', async ({ page }) => {
    await page.getByRole('button', { name: 'Book position' }).click();
    await dragTo(page, offsetOf('〔3-10〕'));
    await page.clock.fastForward(SETTLE);
    await expect(page.locator('.chapter-count')).toHaveText('Chapter 3 of 5');
    await page.keyboard.press('Escape');

    await page.clock.fastForward(10_000);
    await nextPage(page);
    await expect(prompt(page).locator('.word-chip', { hasText: /^今天$/ })).toHaveCount(1);
  });
});
