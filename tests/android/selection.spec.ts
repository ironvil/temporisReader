/**
 * Text selection in the reader: a real long press, which only the WebView makes (the web tests
 * can only hold the mouse down, or set a selection by script).
 */
import { createBook, dismissLanguageReminder, expect, test } from './app';

test('a long press selects text, and a tap clears it', async ({ app }) => {
  const { page } = app;
  await createBook(page, 'Selection test', '猫头鹰在晚上飞。\n它看见了月亮。');
  await page.locator('.book-name', { hasText: 'Selection test' }).click();
  await dismissLanguageReminder(page);

  // Where 月亮 is, in screen pixels (the WebView fills the screen, edge to edge).
  const point = await page.evaluate(() => {
    const block = [...document.querySelectorAll<HTMLElement>('.page-flow [data-block]')].find((b) => b.textContent!.includes('月亮'))!;
    const text = block.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, text.data.indexOf('月'));
    range.setEnd(text, text.data.indexOf('月') + 1);
    const r = range.getBoundingClientRect();
    return { x: Math.round((r.left + r.width / 2) * devicePixelRatio), y: Math.round((r.top + r.height / 2) * devicePixelRatio) };
  });
  const selected = () => page.evaluate(() => document.getSelection()?.toString() ?? '');

  await app.shell(`input swipe ${point.x} ${point.y} ${point.x} ${point.y} 1000`);
  await expect.poll(selected).not.toBe('');
  await expect(page.locator('.lookup-popup')).toBeHidden();

  await app.shell(`input tap ${point.x} ${point.y}`);
  await expect.poll(selected).toBe('');
  await expect(page.locator('.lookup-popup')).toBeHidden();
});
