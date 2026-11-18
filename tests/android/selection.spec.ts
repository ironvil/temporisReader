/**
 * Text selection in the reader: a real long press, which only the WebView makes (the web tests
 * can only hold the mouse down, or set a selection by script), and a real tap on Add to my words
 * while text is selected.
 */
import { createBook, dismissLanguageReminder, expect, test } from './app';

test('a long press selects text, a tap clears it, and a selection can be added as a word', async ({ app }) => {
  const { page } = app;
  await createBook(page, 'Selection test', '猫头鹰在晚上飞。\n它看见了月亮。');
  await page.locator('.book-name', { hasText: 'Selection test' }).click();
  await dismissLanguageReminder(page);

  // Where 月 is, in screen pixels.
  const char = await page.evaluate(() => {
    const block = [...document.querySelectorAll<HTMLElement>('.page-flow [data-block]')].find((b) => b.textContent!.includes('月亮'))!;
    const text = block.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, text.data.indexOf('月'));
    range.setEnd(text, text.data.indexOf('月') + 1);
    const r = range.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const point = await app.screenPoint(char.x, char.y);
  const selected = () => page.evaluate(() => document.getSelection()?.toString() ?? '');

  await app.shell(`input swipe ${point.x} ${point.y} ${point.x} ${point.y} 1000`);
  await expect.poll(selected).toBe('月');
  await expect(page.locator('.lookup-popup')).toBeHidden();

  await app.shell(`input tap ${point.x} ${point.y}`);
  await expect.poll(selected).toBe('');
  await expect(page.locator('.lookup-popup')).toBeHidden();

  // A long press selects one character; the handles stretch it (here, by script) to 月亮. A real
  // tap on Add to my words, in the page indicator's place, must reach it before the tap clears
  // the selection.
  await page.evaluate(() => {
    const block = [...document.querySelectorAll<HTMLElement>('.page-flow [data-block]')].find((b) => b.textContent!.includes('月亮'))!;
    const text = block.firstChild as Text;
    document.getSelection()!.setBaseAndExtent(text, text.data.indexOf('月'), text, text.data.indexOf('月') + 2);
  });
  const button = page.locator('.reader footer .add-word');
  await expect(button).toHaveText('Add “月亮” to my words');
  const box = (await button.boundingBox())!;
  const tap = await app.screenPoint(box.x + box.width / 2, box.y + box.height / 2);
  await app.shell(`input tap ${tap.x} ${tap.y}`);
  const dialog = page.getByRole('dialog', { name: 'Add to my words' });
  await expect(dialog.locator('.add-word-word')).toHaveText('月亮');
});
