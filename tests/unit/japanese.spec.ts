import { expect, test } from '@playwright/test';
import { detectLanguage } from '../../src/languages';
import { ChineseLanguage } from '../../src/languages/zh';
import { JapaneseLanguage, type JapaneseLookup } from '../../src/languages/ja';
import { deinflect } from '../../src/languages/ja/deinflect';
import { toRomaji } from '../../src/languages/ja/romaji';
import { JmdictDictionary } from '../../src/languages/ja/jmdict';
import { decodeEntry, encodeEntry, JmdictIndex, JmdictParser } from '../../src/languages/ja/jmdict-data';
import { fakeJmdictXml } from '../e2e/helpers';

/** JMdict with data already in memory (as after install), skipping download and storage. */
class LoadedJmdict extends JmdictDictionary {
  constructor(index: JmdictIndex | null) {
    super();
    this.data = index;
  }
}

function index(xml = fakeJmdictXml()): JmdictIndex {
  const parser = new JmdictParser();
  for (const line of xml.split('\n')) parser.line(line);
  return new JmdictIndex(new TextEncoder().encode([...parser.lines()].join('\n') + '\n'));
}

const data = index();
const japanese = (loaded = true) => new JapaneseLanguage(new LoadedJmdict(loaded ? data : null));

/** The words of `text` as the reader splits it, each with the key it's tracked under when that differs. */
function words(ja: JapaneseLanguage, text: string): string[] {
  return ja.segmenter
    .segment(text)
    .filter((s) => s.isWord)
    .map((s) => {
      const word = text.slice(s.start, s.end);
      const key = ja.wordKey(word);
      return key === word ? word : `${word}(${key ?? '-'})`;
    });
}

test.describe('the JMdict file', () => {
  test('keeps spellings, readings, senses and the date', () => {
    expect(data.created).toBe('2026-11-01');
    expect(data.entryCount).toBe(1154);
    const eat = data.find('食べる')!;
    expect(eat).toEqual({ segmentable: true, common: true, entries: [expect.any(Number)] });
    const entry = data.entry(eat.entries[0]);
    expect(entry.kanji).toEqual([
      { text: '食べる', common: true, rare: false, hidden: false },
      { text: '喰べる', common: false, rare: false, hidden: true },
    ]);
    expect(entry.readings).toEqual([{ text: 'たべる', common: true, rare: false, hidden: false, noKanji: false, restrict: [] }]);
    // A sense without its own parts of speech has the previous one's.
    expect(entry.senses).toEqual([
      { pos: ['v1', 'vt'], misc: [], glosses: ['to eat'], info: '' },
      { pos: ['v1', 'vt'], misc: [], glosses: ['to live on (e.g. a salary)'], info: '' },
    ]);
    expect(decodeEntry(7, encodeEntry(entry))).toEqual({ ...entry, id: 7 });
  });

  test('every spelling and reading finds the entry; which of them are words as written', () => {
    // A kanji word's reading finds it, but isn't how it's written.
    expect(data.find('たべる')).toMatchObject({ segmentable: false });
    // Search-only spellings neither.
    expect(data.find('喰べる')).toMatchObject({ segmentable: false });
    // Usually written in kana (its main sense): the kana is the word.
    expect(data.find('りんご')).toMatchObject({ segmentable: true });
    // 浜's kana is only for a minor sense (Yokohama): はま isn't a word as written.
    expect(data.find('はま')).toMatchObject({ segmentable: false });
    // Set expressions and titles are looked up, never split into.
    expect(data.find('これは')).toMatchObject({ segmentable: false });
    expect(data.find('雨が降る')).toMatchObject({ segmentable: false });
    expect(data.find('吾輩は猫である')).toMatchObject({ segmentable: false });
    expect(data.find('見当たらない')).toBeNull();
  });

  test('the entries written as the key come first (は the particle before 歯)', () => {
    const ha = data.find('は')!;
    expect(ha.entries.map((id) => data.entry(id).senses[0].glosses[0])).toEqual(['indicates sentence topic', 'tooth']);
  });

  test('XML escapes are decoded; anything without entries is refused', () => {
    const one = index(['<!-- JMdict created: 2026-01-02 -->', '<entry>', '<r_ele>', '<reb>あ</reb>', '</r_ele>', '<sense>', '<pos>&int;</pos>', '<gloss>ah &amp; oh &lt;3</gloss>', '</sense>', '</entry>'].join('\n'));
    expect(one.entry(0).senses[0].glosses).toEqual(['ah & oh <3']);
    expect(() => new JmdictIndex(new TextEncoder().encode('<html>captive portal</html>\n'))).toThrow();
  });
});

test.describe('conjugations', () => {
  const bases = (word: string) => deinflect(word).map((d) => `${d.base} ${d.reasons.join(', ')}`);

  test('verbs, adjectives and the copula are traced back to their dictionary forms', () => {
    const cases: [string, string][] = [
      ['食べました', '食べる polite, past'],
      ['食べなかった', '食べる negative, past'],
      ['食べられる', '食べる passive or potential'],
      ['食べさせられた', '食べる causative, passive or potential, past'],
      ['食べている', '食べる te-form, progressive'],
      ['食べてる', '食べる te-form, progressive'],
      ['食べたい', '食べる want to'],
      ['食べよう', '食べる volitional'],
      ['食べれば', '食べる if'],
      ['書いた', '書く past'],
      ['書かない', '書く negative'],
      ['書きたかった', '書く want to, past'],
      ['書ける', '書く potential'],
      ['書け', '書く imperative'],
      ['書こう', '書く volitional'],
      ['書かせる', '書く causative'],
      ['読んでいる', '読む te-form, progressive'],
      ['読みませんでした', '読む polite, past negative'],
      ['泳いで', '泳ぐ te-form'],
      ['話した', '話す past'],
      ['待って', '待つ te-form'],
      ['死んだ', '死ぬ past'],
      ['遊ばない', '遊ぶ negative'],
      ['買った', '買う past'],
      ['行った', '行く past'],
      ['置いといて', '置く te-form, in advance, te-form'],
      ['来ない', '来る negative'],
      ['こない', 'くる negative'],
      ['来られます', '来る passive or potential, polite'],
      ['きた', 'くる past'],
      ['した', 'する past'],
      ['しなかった', 'する negative, past'],
      ['高くなかった', '高い negative, past'],
      ['高かった', '高い past'],
      ['高くて', '高い te-form'],
      ['高ければ', '高い if'],
      ['よかった', 'よい past'],
      ['でした', 'です past'],
      ['だった', 'だ past'],
    ];
    for (const [word, expected] of cases) expect(bases(word), word).toContain(expected);
  });

  test('a bare ending is no verb', () => {
    expect(bases('た').filter((b) => b.startsWith('る '))).toEqual([]);
    expect(bases('て').filter((b) => b.startsWith('る '))).toEqual([]);
  });
});

test.describe('splitting text into words', () => {
  const ja = japanese();

  test('conjugated words are one word, tracked by their dictionary form', () => {
    expect(words(ja, '私はりんごを食べました。')).toEqual(['私', 'は', 'りんご', 'を', '食べました(食べる)']);
    expect(words(ja, '彼女は本を読んでいる。')).toEqual(['彼女', 'は', '本', 'を', '読んでいる(読む)']);
    expect(words(ja, '先生に褒められて、嬉しかった。')).toEqual(['先生', 'に', '褒められて(褒める)', '嬉しかった(嬉しい)']);
    expect(words(ja, '昨日、映画を見に行った。')).toEqual(['昨日', '映画', 'を', '見(見る)', 'に', '行った(行く)']);
  });

  test('a noun taking する is tracked as the noun', () => {
    expect(words(ja, '勉強しました')).toEqual(['勉強しました(勉強)']);
    expect(words(ja, '勉強する')).toEqual(['勉強する(勉強)']);
  });

  test('set expressions don’t swallow particles; common words win ties', () => {
    expect(words(ja, 'これは猫です')).toEqual(['これ', 'は', '猫', 'です']);
    expect(words(ja, '雨が降った')).toEqual(['雨', 'が', '降った(降る)']);
    // A title in the dictionary isn't one word either.
    expect(words(ja, '吾輩は猫である').slice(0, 3)).toEqual(['吾輩', 'は', '猫']);
    expect(words(ja, 'とても可愛いですね')).toEqual(['とても', '可愛い', 'です', 'ね']);
  });

  test('a kanji word’s bare reading isn’t a word as written (はま isn’t 浜)', () => {
    expect(words(ja, 'はま')).toEqual(['は', 'ま(-)']);
  });

  test('katakana: known words split, unknown names stay whole and untracked', () => {
    expect(words(ja, 'コーヒーカップ')).toEqual(['コーヒー', 'カップ']);
    expect(words(ja, 'メロスは')).toEqual(['メロス(-)', 'は']);
  });

  test('nothing is tracked until the dictionary is loaded', () => {
    expect(japanese(false).wordKey('食べる')).toBeNull();
  });
});

test.describe('lookups', () => {
  const ja = japanese();
  const summary = (entries: JapaneseLookup[]) => entries.map((e) => `${e.phrase ? 'phrase ' : ''}${e.written}→${e.base}:${e.entry.senses[0].glosses[0]}`);

  test('any character of a conjugated word looks up the whole word', async () => {
    const text = '私はりんごを食べました。';
    for (const char of ['食', 'べ', 'し', 'た']) {
      const r = (await ja.lookup(text, text.indexOf(char)))!;
      expect(text.slice(r.start, r.end)).toBe('食べました');
      expect(r.headword).toBe('食べる');
      expect(r.untracked).toBeFalsy();
      expect(summary(r.entries)).toEqual(['食べました→食べる:to eat']);
      expect(r.entries[0].reasons).toEqual(['polite', 'past']);
    }
  });

  test('a word as written isn’t also shown as a conjugation (これ, not 凝る)', async () => {
    const r = (await ja.lookup('これは猫です', 0))!;
    expect(r.headword).toBe('これ');
    expect(summary(r.entries)).toEqual(['これ→これ:this', 'phrase これは→これは:this is']);
  });

  test('set phrases starting at the word are shown after it', async () => {
    const r = (await ja.lookup('何でも', 0))!;
    expect(summary(r.entries)).toEqual(['何で→何で:why?', 'phrase 何でも→何でも:any']);
    const go = (await ja.lookup('映画を見に行った。', 3))!;
    expect(summary(go.entries)).toEqual(['見→見る:to see', 'phrase 見に行った→見に行く:to go to see']);
  });

  test('行った is 行く before 行う', async () => {
    const r = (await ja.lookup('行った', 0))!;
    expect(r.headword).toBe('行く');
    expect(summary(r.entries)).toEqual(['行った→行く:to go', '行った→行う:to perform']);
  });

  test('punctuation and Latin text aren’t looked up; a missing dictionary says so', async () => {
    expect(await ja.lookup('猫。cat', 1)).toBeNull();
    expect(await ja.lookup('猫。cat', 3)).toBeNull();
    const missing = (await japanese(false).lookup('猫', 0))!;
    expect(missing.notice?.kind).toBe('missing-dictionary');
  });
});

test('detection tells Japanese (it has kana) from Chinese', () => {
  const ja = japanese();
  const zh = new ChineseLanguage();
  const japaneseText = '朝の光が高い窓から差し込んで、机の上を静かに照らしていた。';
  const chineseText = '今天早上，阳光从高高的窗户里斜斜地照进来。';
  expect(ja.detect(japaneseText)).toBeGreaterThan(zh.detect(japaneseText));
  expect(ja.detect(chineseText)).toBe(0);
  expect(detectLanguage(japaneseText)).toBe('ja');
  expect(detectLanguage(chineseText)).toBe('zh');
  // A Chinese text quoting a little kana is still Chinese.
  expect(detectLanguage('他说：“ありがとう”，然后走出了房间，回到自己的家里去休息了很久很久。')).toBe('zh');
});

test('romaji: Hepburn, with small kana, double consonants, long vowels and n\'', () => {
  const cases: [string, string][] = [
    ['たべる', 'taberu'],
    ['がっこう', 'gakkou'],
    ['きょう', 'kyou'],
    ['しゃしん', 'shashin'],
    ['ちゅうごく', 'chuugoku'],
    ['まっちゃ', 'matcha'],
    ['しんいち', "shin'ichi"],
    ['こんや', "kon'ya"],
    ['ほんだ', 'honda'],
    ['つづく', 'tsuzuku'],
    ['ふじ', 'fuji'],
    ['コーヒー', 'koohii'],
    ['パーティー', 'paatii'],
    ['ファイル', 'fairu'],
    ['ヴァイオリン', 'vaiorin'],
    ['を', 'o'],
  ];
  for (const [kana, romaji] of cases) expect(toRomaji(kana), kana).toBe(romaji);
});
