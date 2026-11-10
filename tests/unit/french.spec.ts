import { gunzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { FrenchLanguage } from '../../src/languages/fr';
import { FrenchWordSegmenter } from '../../src/languages/fr/segmenter';
import type { WiktionaryDictionary } from '../../src/languages/fr/wiktionary';
import { compareWords, parseLine, sortLines, trimEntry, WiktionaryIndex } from '../../src/languages/fr/wiktionary-data';
import { fakeWiktionary } from '../e2e/helpers';

/** The fixture as installed: trimmed, sorted, indexed. */
function fixtureIndex(): WiktionaryIndex {
  const lines: string[] = [];
  for (const line of gunzipSync(fakeWiktionary()).toString('utf8').split('\n')) {
    try {
      const trimmed = trimEntry(JSON.parse(line));
      if (trimmed) lines.push(trimmed);
    } catch {
      // the fixture's deliberately broken line
    }
  }
  return new WiktionaryIndex(new TextEncoder().encode(sortLines(lines).join('\n') + '\n'));
}

/** Just enough of WiktionaryDictionary for FrenchLanguage. */
function stubDictionary(index: WiktionaryIndex | null): WiktionaryDictionary {
  return {
    shortName: 'WK',
    revision: 1,
    dataKey: index ? 'test' : null,
    isReady: () => !!index,
    ensureLoaded: async () => !!index,
    has: (w: string) => index?.has(w) ?? false,
    entries: (w: string) => index?.entries(w) ?? [],
  } as unknown as WiktionaryDictionary;
}

const words = (seg: { segment(t: string): { start: number; end: number; isWord: boolean }[] }, text: string) =>
  seg.segment(text).filter((s) => s.isWord).map((s) => text.slice(s.start, s.end));

test.describe('trimEntry', () => {
  test('keeps word, part of speech, head, IPA and glosses (with labels)', () => {
    const line = trimEntry({
      word: 'maison',
      pos: 'noun',
      lang_code: 'fr',
      head_templates: [{ expansion: 'maison f (plural maisons)' }],
      sounds: [{ audio: 'x.ogg' } as never, { ipa: '/mɛ.zɔ̃/' }],
      senses: [{ glosses: ['house'] }, { glosses: ['business'], raw_glosses: ['(figuratively) business, firm'] }],
    });
    expect(parseLine(line!)).toEqual({
      word: 'maison',
      pos: 'noun',
      head: 'maison f (plural maisons)',
      ipa: '/mɛ.zɔ̃/',
      senses: [{ gloss: 'house' }, { gloss: '(figuratively) business, firm' }],
    });
  });

  test('inflected forms point at their dictionary form', () => {
    const line = trimEntry({ word: 'mangeaient', pos: 'verb', senses: [{ glosses: ['third-person plural imperfect indicative of manger'], form_of: [{ word: 'manger' }] }] });
    expect(parseLine(line!).senses).toEqual([{ gloss: 'third-person plural imperfect indicative of manger', lemma: 'manger' }]);
  });

  test('nested senses keep the most specific gloss', () => {
    const line = trimEntry({ word: 'x', pos: 'noun', senses: [{ glosses: ['parent sense', 'child sense'] }] });
    expect(parseLine(line!).senses).toEqual([{ gloss: 'child sense' }]);
  });

  test('tabs, newlines and separators inside fields cannot break the format', () => {
    const line = trimEntry({ word: 'x', pos: 'noun', senses: [{ glosses: ['a\tb\nc\u001fd\u001ee'] }] })!;
    expect(line.split('\t')).toHaveLength(5);
    expect(parseLine(line).senses).toEqual([{ gloss: 'a b c d e' }]);
  });

  test('drops entries with nothing useful or in another language', () => {
    expect(trimEntry({ word: 'x', pos: 'noun', senses: [] })).toBeNull();
    expect(trimEntry({ word: 'x', pos: 'noun', senses: [{ glosses: [] }] })).toBeNull();
    expect(trimEntry({ pos: 'noun', senses: [{ glosses: ['y'] }] })).toBeNull();
    expect(trimEntry({ word: 'Hund', pos: 'noun', lang_code: 'de', senses: [{ glosses: ['dog'] }] })).toBeNull();
  });

  test('caps very long entries', () => {
    const senses = Array.from({ length: 50 }, (_, i) => ({ glosses: [`sense ${i} ${'x'.repeat(500)}`] }));
    const parsed = parseLine(trimEntry({ word: 'faire', pos: 'verb', senses })!);
    expect(parsed.senses).toHaveLength(20);
    expect(parsed.senses[0].gloss.length).toBe(300);
  });
});

test.describe('WiktionaryIndex', () => {
  const index = fixtureIndex();

  test('finds every entry for a word, in Wiktionary order', () => {
    expect(index.entries('livre').map((e) => e.pos)).toEqual(['noun', 'verb']);
    expect(index.entries('manger')[0]).toMatchObject({ ipa: '/mɑ̃.ʒe/', senses: [{ gloss: '(transitive) to eat' }] });
  });

  test('exact matches only: no prefixes, case or missing words', () => {
    expect(index.has('mange')).toBe(true);
    expect(index.has('mang')).toBe(false);
    expect(index.has('mangerons')).toBe(false);
    expect(index.has('paris')).toBe(false);
    expect(index.has('Paris')).toBe(true);
    expect(index.has('')).toBe(false);
    expect(index.has('zzz')).toBe(false);
  });

  test('non-ASCII words', () => {
    expect(index.entries('peut-être')[0].senses).toEqual([{ gloss: 'maybe, perhaps' }]);
    expect(index.has("aujourd'hui")).toBe(true);
  });

  test('skips the bad line and other languages', () => {
    expect(index.has('Hund')).toBe(false);
    expect(index.entryCount).toBe(1100 + 23);
  });

  test('sort order matches byte order, including accents, œ and characters outside the BMP', () => {
    const list = ['zèbre', 'été', 'œuvre', 'eau', '𝔞lpha', 'Été', 'ﬁn', 'a'];
    const sorted = sortLines(list.map((w) => `${w}\tnoun\t\t\tgloss`));
    const bytes = [...list].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    expect(sorted.map((l) => l.split('\t')[0])).toEqual(bytes);
    const built = new WiktionaryIndex(new TextEncoder().encode(sorted.join('\n')));
    for (const w of list) expect(built.has(w)).toBe(true);
    expect(compareWords('a', 'ab')).toBeLessThan(0);
  });

  test('works without a trailing newline and when empty', () => {
    const one = new WiktionaryIndex(new TextEncoder().encode('chat\tnoun\t\t\tcat'));
    expect(one.entries('chat')[0].senses).toEqual([{ gloss: 'cat' }]);
    const empty = new WiktionaryIndex(new Uint8Array());
    expect(empty.entryCount).toBe(0);
    expect(empty.has('chat')).toBe(false);
  });
});

test.describe('FrenchWordSegmenter', () => {
  const index = fixtureIndex();
  const segmenter = new FrenchWordSegmenter({ revision: 1, has: (w) => index.has(w) });

  test('splits elisions off unless the whole word is an entry', () => {
    expect(words(segmenter, 'L’homme qu’il a vu')).toEqual(['L’', 'homme', 'qu’', 'il', 'a', 'vu']);
    expect(words(segmenter, "l'homme")).toEqual(["l'", 'homme']);
    expect(words(segmenter, 'Aujourd’hui, jusqu’à')).toEqual(['Aujourd’hui', 'jusqu’', 'à']);
  });

  test('keeps hyphenated dictionary words together and splits the rest', () => {
    expect(words(segmenter, 'Peut-être dis-moi')).toEqual(['Peut-être', 'dis', 'moi']);
  });

  test('spans still cover the whole text', () => {
    const text = 'L’homme, peut-être ; dis-moi !';
    const spans = segmenter.segment(text);
    expect(spans.map((s) => text.slice(s.start, s.end)).join('')).toBe(text);
    spans.slice(1).forEach((s, i) => expect(s.start).toBe(spans[i].end));
  });

  test('without the dictionary, elisions still split and hyphens don’t join', () => {
    const bare = new FrenchWordSegmenter({ revision: 1, has: () => false });
    expect(words(bare, 'l’homme peut-être')).toEqual(['l’', 'homme', 'peut', 'être']);
  });
});

test.describe('FrenchLanguage', () => {
  const fr = new FrenchLanguage(stubDictionary(fixtureIndex()));

  test('known words are tracked by dictionary form', () => {
    expect(fr.wordKey('mangeaient')).toBe('manger');
    expect(fr.wordKey('Mange')).toBe('manger'); // sentence start
    expect(fr.wordKey('manger')).toBe('manger');
    expect(fr.wordKey('belles')).toBe('beau');
    expect(fr.wordKey('L’')).toBe('le');
    expect(fr.wordKey('Aujourd’hui')).toBe("aujourd'hui");
    expect(fr.wordKey('Paris')).toBe('Paris');
    // A word with its own meaning keeps it, even though it's also a form of another word.
    expect(fr.wordKey('livre')).toBe('livre');
  });

  test('untrackable: unknown words, numbers, and anything before the dictionary loads', () => {
    expect(fr.wordKey('lumière')).toBeNull();
    expect(fr.wordKey('1984')).toBeNull();
    expect(new FrenchLanguage(stubDictionary(null)).wordKey('manger')).toBeNull();
  });

  test('lookup returns the tapped span, the key, the form’s notes and the lemma’s entries', async () => {
    const text = 'Les belles maisons mangeaient.';
    const result = await fr.lookup(text, text.indexOf('mangeaient') + 3);
    expect(result).toMatchObject({ start: text.indexOf('mangeaient'), end: text.indexOf('.'), headword: 'manger', source: 'WK' });
    const [entry] = result!.entries;
    expect(entry.surface).toBe('mangeaient');
    expect(entry.own[0].senses).toEqual([{ gloss: 'third-person plural imperfect indicative of manger', lemma: 'manger' }]);
    expect(entry.lemmas.map((e) => e.word)).toEqual(['manger']);
  });

  test('lookup of a word that is both a lemma and a form shows both', async () => {
    const result = await fr.lookup('Un livre.', 4);
    expect(result!.headword).toBe('livre');
    expect(result!.entries[0].own.map((e) => e.pos)).toEqual(['noun', 'verb']);
    expect(result!.entries[0].lemmas.map((e) => e.word)).toEqual(['livrer']);
  });

  test('taps on punctuation or spaces find nothing; unknown words say so', async () => {
    expect(await fr.lookup('Il mange.', 2)).toBeNull();
    expect(await fr.lookup('Il mange.', 8)).toBeNull();
    const missing = await fr.lookup('la lumière', 5);
    expect(missing).toMatchObject({ headword: 'lumière', entries: [], notice: { kind: 'not-found' } });
  });

  test('before the dictionary is added, lookups point to settings', async () => {
    const bare = new FrenchLanguage(stubDictionary(null));
    expect(await bare.lookup('Il mange.', 4)).toMatchObject({ headword: 'mange', notice: { kind: 'missing-dictionary' } });
  });

  test('detects French, but not English or Chinese', () => {
    expect(fr.detect('Aujourd’hui, l’homme mange dans la maison. Il lit un livre, peut-être le plus beau.')).toBeGreaterThan(0.5);
    expect(fr.detect('It was a bright cold day in April, and the clocks were striking thirteen.')).toBeLessThan(0.2);
    expect(fr.detect('今天早上，阳光从高高的窗户里斜斜地照进来。')).toBe(0);
  });
});
