import { gzipSync } from 'node:zlib';
import { expect, type Page } from '@playwright/test';

export const CEDICT_URL = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz';

/** A small CC-CEDICT padded past the installer's 1000-entry sanity check. */
export function fakeCedict(): Buffer {
  const lines = [
    '# CC-CEDICT test fixture',
    '#! date=2026-11-01T00:00:00Z',
    '在 在 [zai4] /to exist; to be alive/(of sb or sth) to be (located) at/(used before a verb to indicate an action in progress)/',
    '頭髮 头发 [tou2 fa5] /hair (on the head)/',
    '頭 头 [tou2] /head/',
    '陽光 阳光 [yang2 guang1] /sunshine/',
    '窗戶 窗户 [chuang1 hu5] /window/',
    '今天 今天 [jin1 tian1] /today/',
    '早上 早上 [zao3 shang5] /early morning/',
    '白金 白金 [bai2 jin1] /platinum/',
    '金色 金色 [jin1 se4] /golden/',
    '鏡子 镜子 [jing4 zi5] /mirror/',
    '貓頭鷹 猫头鹰 [mao1 tou2 ying1] /owl/',
    '了 了 [le5] /' + Array.from({ length: 30 }, (_, i) => `long definition number ${i + 1} to make the popup overflow`).join('/') + '/',
  ];
  for (let i = 0; i < 1100; i++) lines.push(`測${i} 测${i} [ce4] /filler ${i}/`);
  return gzipSync(Buffer.from(lines.join('\n')));
}

export const WIKTIONARY_FR_URL = 'https://kaikki.org/dictionary/French/kaikki.org-dictionary-French.jsonl.gz';

/** A few kaikki.org-shaped French entries, padded past the installer's 1000-entry sanity check. */
export function fakeWiktionary(): Buffer {
  const sense = (gloss: string, extra: Record<string, unknown> = {}) => ({ glosses: [gloss], ...extra });
  const formOf = (gloss: string, lemma: string) => ({ glosses: [gloss], form_of: [{ word: lemma }], tags: ['form-of'] });
  const entry = (word: string, pos: string, senses: unknown[], extra: Record<string, unknown> = {}) => ({ word, pos, lang: 'French', lang_code: 'fr', senses, ...extra });
  const entries = [
    entry('manger', 'verb', [sense('to eat', { raw_glosses: ['(transitive) to eat'] })], { sounds: [{ ipa: '/mɑ̃.ʒe/' }, { audio: 'Fr-manger.ogg' }], head_templates: [{ expansion: 'manger' }] }),
    entry('mange', 'verb', [formOf('first/third-person singular present indicative of manger', 'manger')]),
    entry('mangeaient', 'verb', [formOf('third-person plural imperfect indicative of manger', 'manger')]),
    entry('maison', 'noun', [sense('house'), sense('home')], { head_templates: [{ expansion: 'maison f (plural maisons)' }], sounds: [{ ipa: '/mɛ.zɔ̃/' }] }),
    entry('maisons', 'noun', [formOf('plural of maison', 'maison')]),
    entry('livre', 'noun', [sense('book')], { head_templates: [{ expansion: 'livre m (plural livres)' }] }),
    entry('livre', 'verb', [formOf('first/third-person singular present indicative of livrer', 'livrer')]),
    entry('livrer', 'verb', [sense('to deliver')]),
    entry('beau', 'adj', [sense('beautiful, handsome')], { head_templates: [{ expansion: 'beau (feminine belle, masculine plural beaux, feminine plural belles)' }] }),
    entry('belles', 'adj', [formOf('feminine plural of beau', 'beau')]),
    entry('le', 'article', [sense('the (definite article)')]),
    entry("l'", 'article', [formOf('apocopic form of le, la: the', 'le')]),
    entry('homme', 'noun', [sense('man')]),
    entry('il', 'pron', [sense('he')]),
    entry('dans', 'prep', [sense('in, inside')]),
    entry('la', 'article', [sense('the (feminine definite article)')]),
    entry("aujourd'hui", 'adv', [sense('today')]),
    entry('peut-être', 'adv', [sense('maybe, perhaps')]),
    entry('un', 'article', [sense('a, an')]),
    entry('lit', 'verb', [formOf('third-person singular present indicative of lire', 'lire')]),
    entry('lire', 'verb', [sense('to read')]),
    entry('Paris', 'name', [sense('Paris (the capital of France)')]),
    entry('plus', 'adv', [sense('more')]),
    entry('Hund', 'noun', [sense('dog')], { lang: 'German', lang_code: 'de' }),
  ];
  const lines = entries.map((e) => JSON.stringify(e));
  for (let i = 0; i < 1100; i++) lines.push(JSON.stringify(entry(`remplissage${i}`, 'noun', [sense(`filler ${i}`)])));
  lines.splice(5, 0, '{ not json');
  return gzipSync(Buffer.from(lines.join('\n') + '\n'));
}

export function frenchBook(): string {
  const sentences = [
    'Aujourd’hui, l’homme mange dans la maison.',
    'Il lit un livre, peut-être le plus beau livre de Paris.',
    'Les belles maisons mangeaient la lumière du matin.',
  ];
  // Markdown headings: the plain-text chapter detection only knows Chinese chapter titles.
  const chapter = (title: string, n: number) => [`# ${title}`, ...Array.from({ length: n }, (_, i) => sentences[i % sentences.length])].join('\n\n');
  return [chapter('Chapitre un', 30), chapter('Chapitre deux', 6)].join('\n\n');
}

/** Settings → Languages → French → Add, serving a fake kaikki.org extract. */
export async function addFrench(page: Page): Promise<void> {
  await page.route(WIKTIONARY_FR_URL, (route) =>
    route.fulfill({ status: 200, contentType: 'application/octet-stream', body: fakeWiktionary(), headers: { 'access-control-allow-origin': '*' } }),
  );
  await page.getByRole('button', { name: 'Settings' }).click();
  const card = page.locator('[data-language="fr"]');
  await card.getByRole('button', { name: 'Add' }).click();
  await expect(card.locator('.lang-status')).toHaveText('Added');
  await page.getByRole('button', { name: 'Close settings' }).click();
}

export function chineseBook(): string {
  const sentences = [
    '今天早上，阳光从高高的窗户里斜斜地照进来，落在桌子上，落在银梳子上，落在她的头发上。',
    '她的头发是白金色的，长而直，在光里几乎是亮的。',
    '她坐得很直，不要去对象其平，头的时候不说话，一下，又一下，慢得好像时间也是庄园里的一样东西。',
    '“我想要一只黑色的猫头鹰。”德拉科尼娅对镜子说。',
  ];
  const chapter = (title: string, n: number) => [title, ...Array.from({ length: n }, (_, i) => sentences[i % sentences.length])].join('\n');
  return [chapter('第一章 早上', 40), chapter('第二章 镜子', 12)].join('\n');
}

export async function importBook(page: Page, name: string, content: string): Promise<void> {
  await page.getByTestId('import-input').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(content) });
  await expect(page.getByText(/^Imported/)).toBeVisible();
}

export async function openFirstBook(page: Page): Promise<void> {
  await page.locator('.book-open').first().click();
  await expect(page.locator('.page-count')).toHaveText(/^\d+ \/ \d+$/);
  await dismissLanguageReminder(page);
}

/** Matches the "Add <language>?" reminder and the unsupported-language notice shown when a book opens. */
export const LANGUAGE_REMINDER = /^(Add .+\?|Lookups aren’t available)$/;

/** Waits for the reader's language check and closes its reminder/notice with "Not now" if one appeared. */
export async function dismissLanguageReminder(page: Page): Promise<void> {
  await expect(page.locator('.reader[data-language-check="done"]')).toBeAttached();
  const reminder = page.getByRole('dialog', { name: LANGUAGE_REMINDER });
  if (await reminder.count()) await reminder.getByRole('button', { name: 'Not now' }).click();
  await expect(reminder).toHaveCount(0);
}

/** Settings → Languages → Chinese → Add, serving a fake CC-CEDICT. */
export async function addChinese(page: Page): Promise<void> {
  await page.route(CEDICT_URL, (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-gzip', body: fakeCedict(), headers: { 'access-control-allow-origin': '*' } }),
  );
  await page.getByRole('button', { name: 'Settings' }).click();
  const card = page.locator('[data-language="zh"]');
  await card.getByRole('button', { name: 'Add' }).click();
  await expect(card.locator('.lang-status')).toHaveText('Added');
  await page.getByRole('button', { name: 'Close settings' }).click();
}

/** Waits for page-turn animations to finish so geometry is stable. */
export async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelector('.page-flow')!.getAnimations().length === 0);
}

export async function pageIndicator(page: Page): Promise<{ page: number; total: number }> {
  const [current, total] = (await page.locator('.page-count').textContent())!.split(' / ').map(Number);
  return { page: current, total };
}

/** Taps the first occurrence of `needle` visible on the current page, at character `charOffset` within it. */
/** Closes the lookup popup the way a reader would: by tapping somewhere else (the header title). */
export async function dismissLookup(page: Page): Promise<void> {
  const popup = page.locator('.lookup-popup');
  if (!(await popup.isVisible())) return;
  await page.locator('.reader .bar-title').click();
  await expect(popup).toBeHidden();
}

/** Taps a character on the current page. An open popup is dismissed first (a tap while it's open only closes it). */
export async function tapText(page: Page, needle: string, charOffset = 0): Promise<void> {
  await dismissLookup(page);
  const point = await page.evaluate(
    ({ needle, charOffset }) => {
      const area = document.querySelector('.page-area')!.getBoundingClientRect();
      const position = (block: HTMLElement, offset: number) => {
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
          if (offset < n.length) return { node: n, offset };
          offset -= n.length;
        }
        throw new Error('offset out of range');
      };
      for (const block of document.querySelectorAll<HTMLElement>('.page-flow [data-block]')) {
        const text = block.textContent!;
        let from = 0;
        let at: number;
        while ((at = text.indexOf(needle, from)) >= 0) {
          const range = document.createRange();
          const p = position(block, at + charOffset);
          range.setStart(p.node, p.offset);
          range.setEnd(p.node, p.offset + 1);
          const r = range.getBoundingClientRect();
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          const onPage = r.left >= area.left && r.right <= area.right && r.top >= area.top && r.bottom <= area.bottom;
          // Skip text hidden under the popup, like a finger would.
          if (onPage && block.contains(document.elementFromPoint(x, y))) return { x, y };
          from = at + 1;
        }
      }
      return null;
    },
    { needle, charOffset },
  );
  if (!point) throw new Error(`"${needle}" is not visible on this page`);
  await page.mouse.click(point.x, point.y);
}

/** Next page via the keyboard (arrow keys turn pages, like swipes). */
export async function nextPage(page: Page, times = 1): Promise<void> {
  for (let i = 0; i < times; i++) await page.keyboard.press('ArrowRight');
}

export async function swipe(page: Page, direction: 'left' | 'right'): Promise<void> {
  const box = (await page.locator('.page-area').boundingBox())!;
  const y = box.y + box.height / 2;
  const [from, to] = direction === 'left' ? [box.x + box.width * 0.8, box.x + box.width * 0.2] : [box.x + box.width * 0.2, box.x + box.width * 0.8];
  await page.mouse.move(from, y);
  await page.mouse.down();
  await page.mouse.move(to, y, { steps: 6 });
  await page.mouse.up();
}
