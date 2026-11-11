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
    entry('belles', 'adj', [formOf('feminine plural of beau', 'beau')], { sounds: [{ ipa: '/bɛl/' }] }),
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

export const WIKTIONARY_DE_URL = 'https://kaikki.org/dictionary/German/kaikki.org-dictionary-German.jsonl.gz';

/** kaikki.org-shaped German entries for separable verbs, compounds and sentence-initial capitals. */
export function fakeGermanWiktionary(): Buffer {
  const sense = (gloss: string) => ({ glosses: [gloss] });
  const formOf = (gloss: string, lemma: string) => ({ glosses: [gloss], form_of: [{ word: lemma }], tags: ['form-of'] });
  const entry = (word: string, pos: string, senses: unknown[], extra: Record<string, unknown> = {}) => ({ word, pos, lang: 'German', lang_code: 'de', senses, ...extra });
  const entries = [
    entry('fangen', 'verb', [sense('to catch')], { sounds: [{ ipa: '/ˈfaŋən/' }] }),
    entry('fängt', 'verb', [formOf('third-person singular present of fangen', 'fangen')]),
    entry('anfangen', 'verb', [sense('to begin, to start')], { head_templates: [{ expansion: 'anfangen (class 7 strong, third-person singular present fängt an)' }], sounds: [{ ipa: '/ˈanˌfaŋən/' }] }),
    entry('an', 'prep', [sense('on, at')]),
    entry('kommen', 'verb', [sense('to come')]),
    entry('kommt', 'verb', [formOf('third-person singular present of kommen', 'kommen')]),
    entry('zurück', 'adv', [sense('back')]),
    entry('zurückkommen', 'verb', [sense('to come back, to return')]),
    entry('denken', 'verb', [sense('to think')]),
    entry('denkt', 'verb', [formOf('third-person singular present of denken', 'denken')]),
    entry('er', 'pron', [sense('he')]),
    entry('sie', 'pron', [sense('she; they')]),
    entry('morgen', 'adv', [sense('tomorrow')]),
    entry('Morgen', 'noun', [sense('morning')], { head_templates: [{ expansion: 'Morgen m (strong, genitive Morgens, plural Morgen)' }] }),
    entry('Ich', 'noun', [sense('the self, the ego')]),
    entry('ich', 'pron', [sense('I')]),
    entry('Haus', 'noun', [sense('house')], { head_templates: [{ expansion: 'Haus n (strong, genitive Hauses, plural Häuser, diminutive Häuschen n or Häuslein n or Häuselein n or Häusle n or Häusel n or Häus\'l n or Häusl n or Häusli n or Häuslin n or (rare) Häuselin n)' }] }),
    entry('Häuser', 'noun', [formOf('nominative/accusative/genitive plural of Haus', 'Haus')]),
    entry('Tür', 'noun', [sense('door')], { head_templates: [{ expansion: 'Tür f (genitive Tür, plural Türen)' }] }),
    entry('Schlüssel', 'noun', [sense('key')]),
    entry('Donau', 'name', [sense('Danube')]),
    entry('Dampfschiff', 'noun', [sense('steamship')]),
    entry('Dampfschiffs', 'noun', [formOf('genitive singular of Dampfschiff', 'Dampfschiff')]),
    entry('Kapitän', 'noun', [sense('captain')]),
    entry('der', 'article', [sense('the')]),
    entry('die', 'article', [formOf('nominative/accusative feminine singular of der', 'der')]),
    entry('mit', 'prep', [sense('with')]),
    entry('dich', 'pron', [formOf('accusative of du', 'du')]),
    entry('du', 'pron', [sense('you')]),
    entry('ist', 'verb', [formOf('third-person singular present of sein', 'sein')]),
    entry('sein', 'verb', [sense('to be')]),
    entry('alt', 'adj', [sense('old')]),
    entry('und', 'conj', [sense('and')]),
  ];
  const lines = entries.map((e) => JSON.stringify(e));
  for (let i = 0; i < 1100; i++) lines.push(JSON.stringify(entry(`Füllwort${i}`, 'noun', [sense(`filler ${i}`)])));
  return gzipSync(Buffer.from(lines.join('\n') + '\n'));
}

export function germanBook(): string {
  const sentences = [
    'Er fängt morgen an.',
    'Sie kommt zurück, und er denkt an dich.',
    'Ich sehe die Häuser.',
    'Der Donaudampfschiffskapitän ist alt.',
    'Er fängt mit dem Haustürschlüssel an.',
  ];
  const chapter = (title: string, n: number) => [`# ${title}`, ...Array.from({ length: n }, (_, i) => sentences[i % sentences.length])].join('\n\n');
  return [chapter('Erstes Kapitel', 25), chapter('Zweites Kapitel', 5)].join('\n\n');
}

/** Settings → Languages → German → Add, serving a fake kaikki.org extract. */
export async function addGerman(page: Page): Promise<void> {
  await page.route(WIKTIONARY_DE_URL, (route) =>
    route.fulfill({ status: 200, contentType: 'application/octet-stream', body: fakeGermanWiktionary(), headers: { 'access-control-allow-origin': '*' } }),
  );
  await openLanguageSettings(page, 'de');
  const card = page.locator('[data-language="de"]');
  await card.getByRole('button', { name: 'Add' }).click();
  await expect(card.locator('.lang-status')).toHaveText('Added');
  await closeSettings(page);
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
  await openLanguageSettings(page, 'fr');
  const card = page.locator('[data-language="fr"]');
  await card.getByRole('button', { name: 'Add' }).click();
  await expect(card.locator('.lang-status')).toHaveText('Added');
  await closeSettings(page);
}

export const JMDICT_URL = 'https://www.edrdg.org/pub/Nihongo/JMdict_e.gz';

/**
 * One JMdict entry as XML, from a short form: kanji and readings marked `*` are common spellings,
 * `!` search-only, `~` not a true reading (re_nokanji); a sense is [parts of speech, glosses, misc].
 */
function jmEntry(kanji: string[], readings: string[], senses: [string, string, string?][]): string {
  const mark = (s: string) => ({ text: s.replace(/[*!~]+$/, ''), common: /\*/.test(s), hidden: /!/.test(s), noKanji: /~/.test(s) });
  const lines = ['<entry>', '<ent_seq>1</ent_seq>'];
  for (const k of kanji.map(mark)) {
    lines.push('<k_ele>', `<keb>${k.text}</keb>`);
    if (k.hidden) lines.push('<ke_inf>&sK;</ke_inf>');
    if (k.common) lines.push('<ke_pri>ichi1</ke_pri>');
    lines.push('</k_ele>');
  }
  for (const r of readings.map(mark)) {
    lines.push('<r_ele>', `<reb>${r.text}</reb>`);
    if (r.noKanji) lines.push('<re_nokanji/>');
    if (r.common) lines.push('<re_pri>ichi1</re_pri>');
    lines.push('</r_ele>');
  }
  for (const [pos, glosses, misc] of senses) {
    lines.push('<sense>', ...pos.split(' ').filter(Boolean).map((p) => `<pos>&${p};</pos>`));
    lines.push(...(misc ?? '').split(' ').filter(Boolean).map((m) => `<misc>&${m};</misc>`));
    lines.push(...glosses.split(';').map((g) => `<gloss>${g.trim()}</gloss>`), '</sense>');
  }
  lines.push('</entry>');
  return lines.join('\n');
}

/** A small JMdict (the real file's XML layout), padded past the installer's 1000-entry sanity check. */
export function fakeJmdictXml(): string {
  const entries = [
    jmEntry(['私*'], ['わたし*'], [['pn', 'I; me']]),
    jmEntry([], ['は*'], [['prt', 'indicates sentence topic']]),
    jmEntry(['歯*'], ['は*'], [['n', 'tooth']]),
    jmEntry(['浜*'], ['はま*'], [['n', 'beach'], ['n', 'Yokohama', 'abbr uk']]),
    jmEntry(['林檎*'], ['りんご*'], [['n', 'apple', 'uk']]),
    jmEntry([], ['を*'], [['prt', 'indicates direct object of action']]),
    jmEntry(['食べる*', '喰べる!'], ['たべる*'], [['v1 vt', 'to eat'], ['', 'to live on (e.g. a salary)']]),
    jmEntry(['見る*'], ['みる*'], [['v1 vt', 'to see; to look']]),
    jmEntry(['行く*'], ['いく*', 'ゆく*'], [['v5k-s vi', 'to go; to move (towards)']]),
    jmEntry(['行う*'], ['おこなう*'], [['v5u vt', 'to perform; to do']]),
    jmEntry(['言う*'], ['いう*'], [['v5u', 'to say']]),
    jmEntry(['来る*'], ['くる*'], [['vk vi', 'to come']]),
    jmEntry(['為る'], ['する*'], [['vs-i', 'to do', 'uk']]),
    jmEntry(['勉強*'], ['べんきょう*'], [['n vs vt', 'study']]),
    jmEntry(['読む*'], ['よむ*'], [['v5m vt', 'to read']]),
    jmEntry(['書く*'], ['かく*'], [['v5k vt', 'to write']]),
    jmEntry(['居る*'], ['いる*'], [['v1 vi', 'to be (of animate objects); to exist', 'uk']]),
    jmEntry(['猫*'], ['ねこ*'], [['n', 'cat']]),
    jmEntry([], ['です*'], [['cop aux-v', 'be; is', 'pol']]),
    jmEntry([], ['だ*'], [['cop aux-v', 'be; is']]),
    jmEntry(['此れ'], ['これ*'], [['pn', 'this', 'uk']]),
    jmEntry(['此れは'], ['これは'], [['exp', 'this is', 'uk'], ['int', 'well, well; oh dear']]),
    jmEntry(['何でも'], ['なんでも*'], [['exp', 'any; anything', 'uk'], ['adv', 'by all means', 'uk']]),
    jmEntry(['何で*'], ['なんで*'], [['adv', 'why?; what for?']]),
    jmEntry(['何*'], ['なに*'], [['pn', 'what']]),
    jmEntry([], ['も*'], [['prt', 'too; also']]),
    jmEntry([], ['の*'], [['prt', 'indicates possessive']]),
    jmEntry(['可愛い*'], ['かわいい*'], [['adj-i', 'cute; adorable', 'uk']]),
    jmEntry([], ['ね*'], [['prt', 'right?; isn\'t it?']]),
    jmEntry([], ['とても*'], [['adv', 'very']]),
    jmEntry(['高い*'], ['たかい*'], [['adj-i', 'high; tall']]),
    jmEntry(['無い*'], ['ない*'], [['adj-i', 'nonexistent; not being (there)', 'uk']]),
    jmEntry(['先生*'], ['せんせい*'], [['n', 'teacher']]),
    jmEntry([], ['に*'], [['prt', 'at (place, time); in; on; to']]),
    jmEntry(['褒める*'], ['ほめる*'], [['v1 vt', 'to praise']]),
    jmEntry(['嬉しい*'], ['うれしい*'], [['adj-i', 'happy; glad']]),
    jmEntry(['凝る*'], ['こる*'], [['v5r vi', 'to be absorbed in']]),
    jmEntry(['雨*'], ['あめ*'], [['n', 'rain']]),
    jmEntry([], ['が*'], [['prt', 'indicates sentence subject']]),
    jmEntry(['降る*'], ['ふる*'], [['v5r vi', 'to fall (of rain, snow)']]),
    jmEntry(['雨が降る*'], ['あめがふる*'], [['exp v5r', 'to rain']]),
    jmEntry(['吾輩は猫である'], ['わがはいはねこである'], [['n', 'I Am a Cat (novel by Natsume Sōseki)', 'work']]),
    jmEntry(['吾輩'], ['わがはい'], [['pn', 'I; me (arrogant)']]),
    jmEntry(['見に行く'], ['みにいく'], [['exp v5k-s', 'to go to see']]),
    jmEntry(['映画*'], ['えいが*'], [['n', 'movie; film']]),
    jmEntry(['置く*'], ['おく*'], [['v5k vt', 'to put; to place']]),
    jmEntry([], ['コーヒー*'], [['n', 'coffee']]),
    jmEntry([], ['カップ*'], [['n', 'cup']]),
    jmEntry(['本*'], ['ほん*'], [['n', 'book']]),
    jmEntry(['彼女*'], ['かのじょ*'], [['pn', 'she; her']]),
    jmEntry([], ['で*'], [['prt', 'at; in']]),
    jmEntry([], ['て*'], [['prt', 'and (te-form)']]),
    jmEntry(['昨日*'], ['きのう*'], [['n adv', 'yesterday']]),
    jmEntry(['了'], ['りょう'], [['n', Array.from({ length: 30 }, (_, i) => `long gloss number ${i + 1} to make the popup overflow`).join('; ')]]),
  ];
  for (let i = 0; i < 1100; i++) entries.push(jmEntry([`試${i}`], ['し'], [['n', `filler ${i}`]]));
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE JMdict [', '<!ENTITY v1 "Ichidan verb">', ']>', '<!-- JMdict created: 2026-11-01 -->', '<JMdict>', ...entries, '</JMdict>', ''].join('\n');
}

export function fakeJmdict(): Buffer {
  return gzipSync(Buffer.from(fakeJmdictXml()));
}

export function japaneseBook(): string {
  const sentences = [
    '私はりんごを食べました。',
    '彼女は本を読んでいる。',
    'これは私の猫です。とても可愛いですね。',
    '先生に褒められて、嬉しかった。',
    '昨日、映画を見に行った。',
  ];
  const chapter = (title: string, n: number) => [`# ${title}`, ...Array.from({ length: n }, (_, i) => sentences[i % sentences.length])].join('\n\n');
  return [chapter('第一章', 30), chapter('第二章', 5)].join('\n\n');
}

/** Settings → Languages → Japanese → Add, serving a fake JMdict. */
export async function addJapanese(page: Page): Promise<void> {
  await page.route(JMDICT_URL, (route) =>
    route.fulfill({ status: 200, contentType: 'application/octet-stream', body: fakeJmdict(), headers: { 'access-control-allow-origin': '*' } }),
  );
  await openLanguageSettings(page, 'ja');
  const card = page.locator('[data-language="ja"]');
  await card.getByRole('button', { name: 'Add' }).click();
  await expect(card.locator('.lang-status')).toHaveText('Added');
  await closeSettings(page);
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
  await openLanguageSettings(page, 'zh');
  const card = page.locator('[data-language="zh"]');
  await card.getByRole('button', { name: 'Add' }).click();
  await expect(card.locator('.lang-status')).toHaveText('Added');
  await closeSettings(page);
}

/** Settings → Languages → that language's page (opening Settings first if needed). */
export async function openLanguageSettings(page: Page, language: string): Promise<void> {
  const settings = page.locator('.view.settings');
  if (!(await settings.isVisible())) await page.locator('.view:not([hidden])').getByRole('button', { name: 'Settings', exact: true }).click();
  if (await settings.getByRole('button', { name: 'Back to settings' }).isVisible()) await settings.getByRole('button', { name: 'Back to settings' }).click();
  await settings.locator(`[data-language-link="${language}"]`).click();
  await expect(settings.locator(`[data-language="${language}"]`)).toBeVisible();
}

/** Closes Settings from either level. */
export async function closeSettings(page: Page): Promise<void> {
  const settings = page.locator('.view.settings');
  const back = settings.getByRole('button', { name: 'Back to settings' });
  if (await back.isVisible()) await back.click();
  await settings.getByRole('button', { name: 'Close settings' }).click();
  await expect(settings).toBeHidden();
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

/** Runs `fn` against the web Filesystem's IndexedDB (where the app's files and the stand-in device storage live). */
export function withStorage<T, A>(page: Page, fn: (s: Storage, arg: A) => Promise<T>, arg: A): Promise<T> {
  return page.evaluate(
    async ({ source, arg }) => {
      const db: IDBDatabase = await new Promise((res, rej) => {
        const o = indexedDB.open('Disc');
        o.onsuccess = () => res(o.result);
        o.onerror = () => rej(o.error);
      });
      const store = () => db.transaction('FileStorage', 'readwrite').objectStore('FileStorage');
      const req = <R>(r: IDBRequest<R>) => new Promise<R>((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
      const s = {
        keys: async () => (await req(store().getAllKeys())) as string[],
        get: (key: string) => req(store().get(key)),
        put: (value: unknown) => req(store().put(value)),
        remove: (key: string) => req(store().delete(key)),
      };
      // eslint-disable-next-line no-new-func
      return new Function('s', 'arg', `return (${source})(s, arg)`)(s, arg);
    },
    { source: fn.toString(), arg },
  ) as Promise<T>;
}

export interface Storage {
  keys(): Promise<string[]>;
  get(key: string): Promise<any>;
  put(value: unknown): Promise<unknown>;
  remove(key: string): Promise<unknown>;
}
