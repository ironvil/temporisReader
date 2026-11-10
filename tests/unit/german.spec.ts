import { gunzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { GermanLanguage } from '../../src/languages/de';
import { sortLines, trimEntry, WiktionaryIndex } from '../../src/languages/wiktionary/data';
import type { WiktionaryDictionary } from '../../src/languages/wiktionary/dictionary';
import { fakeGermanWiktionary } from '../e2e/helpers';

function german(loaded = true): GermanLanguage {
  const lines = gunzipSync(fakeGermanWiktionary())
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => trimEntry(JSON.parse(l), 'de'))
    .filter((l): l is string => !!l);
  const index = new WiktionaryIndex(new TextEncoder().encode(sortLines(lines).join('\n') + '\n'));
  const dict = {
    shortName: 'WK',
    revision: 1,
    dataKey: 'test',
    isReady: () => loaded,
    ensureLoaded: async () => loaded,
    has: (w: string) => loaded && index.has(w),
    entries: (w: string) => (loaded ? index.entries(w) : []),
  } as unknown as WiktionaryDictionary;
  return new GermanLanguage(dict);
}

/** Keys of the words in `text` (null for words that aren't tracked), as the reader counts them. */
function keys(de: GermanLanguage, text: string): (string | null)[] {
  const spans = de.segmenter.segment(text);
  return de.contextKeys(text, spans).filter((_, i) => spans[i].isWord);
}

test.describe('separable verbs', () => {
  const de = german();

  test('a clause-final particle joins its verb', () => {
    expect(keys(de, 'Er fängt morgen an.')).toEqual(['er', 'anfangen', 'morgen', null]);
    expect(keys(de, 'Sie kommt zurück, und er denkt an dich.')).toEqual(['sie', 'zurückkommen', null, 'und', 'er', 'denken', 'an', 'du']);
  });

  test('only when particle + verb is a dictionary verb, and only at the clause end', () => {
    expect(keys(de, 'Er denkt an.')).toEqual(['er', 'denken', 'an']); // no "andenken" in the fixture
    expect(keys(de, 'Er fängt an der Tür.')).toEqual(['er', 'fangen', 'an', 'der', 'Tür']);
    expect(keys(de, 'Fängt er an?')).toEqual(['anfangen', 'er', null]); // sentence-initial verb
  });

  test('tapping the verb or the particle looks up the whole verb', async () => {
    const text = 'Er fängt morgen an.';
    for (const tap of [text.indexOf('fängt') + 1, text.indexOf(' an') + 1]) {
      const result = await de.lookup(text, tap);
      expect(result!.headword).toBe('anfangen');
      const [entry] = result!.entries;
      expect(entry.display).toBe('fängt … an');
      expect(entry.lemmas.map((e) => e.word)).toEqual(['anfangen', 'fangen']);
    }
    // The highlighted span is the word that was tapped.
    const particle = await de.lookup(text, text.indexOf(' an') + 1);
    expect(text.slice(particle!.start, particle!.end)).toBe('an');
  });
});

test.describe('compounds', () => {
  const de = german();

  test('split into the fewest dictionary parts, with linking elements', () => {
    expect(de.compoundParts('Donaudampfschiffskapitän')).toEqual(['Donau', 'Dampfschiff', 'Kapitän']);
    expect(de.compoundParts('Haustürschlüssel')).toEqual(['Haus', 'Tür', 'Schlüssel']);
    expect(de.compoundParts('Haustür')).toEqual(['Haus', 'Tür']);
  });

  test('no split for words that are not compounds of known words', () => {
    expect(de.compoundParts('Haus')).toBeNull(); // one part
    expect(de.compoundParts('Haushaltsplanung')).toBeNull();
    expect(de.compoundParts('Haustürs')).toBeNull(); // a linking element can't end the word
  });

  test('a compound lookup shows its parts and is not tracked', async () => {
    const text = 'Der Donaudampfschiffskapitän ist alt.';
    const result = await de.lookup(text, text.indexOf('Donau') + 3);
    expect(result).toMatchObject({ headword: 'Donaudampfschiffskapitän', untracked: true });
    expect(result!.entries[0].parts).toEqual(['Donau', 'Dampfschiff', 'Kapitän']);
    expect(result!.entries[0].lemmas.map((e) => e.word)).toEqual(['Donau', 'Dampfschiff', 'Kapitän']);
    expect(de.wordKey('Donaudampfschiffskapitän')).toBeNull();
  });
});

test.describe('capitals', () => {
  const de = german();

  test('at a sentence start the lower-case word wins; elsewhere nouns keep their capital', () => {
    expect(keys(de, 'Ich sehe die Häuser.')).toEqual(['ich', null, 'der', 'Haus']);
    expect(keys(de, 'Morgen. Er kommt am Morgen.')).toEqual(['morgen', 'er', 'kommen', null, 'Morgen']);
  });

  test('a sentence-initial lookup also shows the capitalised entry', async () => {
    const result = await de.lookup('Morgen kommt er.', 2);
    expect(result!.headword).toBe('morgen');
    expect(result!.entries[0].own.map((e) => e.word)).toEqual(['morgen']);
    expect(result!.entries[0].lemmas.map((e) => e.word)).toEqual(['Morgen']);
  });
});

test.describe('GermanLanguage', () => {
  test('long headword lines are shortened', () => {
    const [haus] = german().wiktionary.entries('Haus');
    expect(haus.head.length).toBeLessThanOrEqual(160);
    expect(haus.head).toMatch(/^Haus n \(strong, genitive Hauses, plural Häuser, diminutive .*…$/);
  });

  test('nothing is tracked before the dictionary loads', () => {
    const de = german(false);
    expect(keys(de, 'Er fängt morgen an.')).toEqual([null, null, null, null]);
  });

  test('detects German, but not French, English or Chinese', () => {
    const de = german();
    expect(de.detect('Er fängt morgen mit der Arbeit an, und sie kommt zurück. Ich sehe die Häuser.')).toBeGreaterThan(0.5);
    expect(de.detect('Aujourd’hui, l’homme mange dans la maison. Il lit un livre.')).toBeLessThan(0.2);
    expect(de.detect('It was a bright cold day in April, and the clocks were striking thirteen.')).toBeLessThan(0.2);
    expect(de.detect('今天早上，阳光从高高的窗户里斜斜地照进来。')).toBe(0);
  });
});
