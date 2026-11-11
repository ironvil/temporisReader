/**
 * JMdict, downloaded from EDRDG at runtime (never bundled in the APK), streamed through once and
 * stored trimmed (see jmdict-data.ts). Lookups follow conjugations back to the dictionary form.
 */
import { forEachLine, gunzipBytes, gzipBytes } from '../../download';
import type { WordList } from '../../segmentation/dictionary';
import { readStream } from '../../storage';
import { DownloadedDictionary, type Processed } from '../downloaded-dictionary';
import { deinflect, matchesPos, VS } from './deinflect';
import { JmdictIndex, JmdictParser, type JmdictEntry } from './jmdict-data';

export const JMDICT_URL = 'https://www.edrdg.org/pub/Nihongo/JMdict_e.gz';

/** Sanity check so a captive-portal page or truncated file isn't installed as a dictionary. */
const MIN_ENTRIES = 1000;
const COMMON_COST = 10;
const WORD_COST = 14;
/** More than two common words (コーヒー | カップ stays two), less than a word and a stray kana. */
const UNKNOWN_KATAKANA_COST = 25;
const UNKNOWN_CHAR_COST = 20;
const KATAKANA_WORD = /^[\p{Script=Katakana}ー]{2,}$/u;

/** How much longer than its dictionary form a conjugated word can be (書かせられなかった). */
const INFLECTION_ROOM = 8;

/** A dictionary entry a written word was matched to. */
export interface JmdictMatch {
  entry: JmdictEntry;
  /** The form looked up: the word itself, or its dictionary form (食べました → 食べる). */
  base: string;
  /** How the word was conjugated from `base`, outermost last; empty when written as is. */
  reasons: string[];
}

export class JmdictDictionary extends DownloadedDictionary<JmdictIndex> implements WordList {
  readonly id = 'jmdict';
  readonly name = 'JMdict';
  readonly shortName = 'JM';
  readonly description = 'Japanese → English, about 210,000 entries';
  readonly downloadSize = '11 MB';
  readonly license = 'CC BY-SA 4.0, EDRDG';
  readonly homepage = 'https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project';
  private readonly words = new Map<string, { base: string; common: boolean } | null>();
  private wordsRevision = -1;

  constructor(url = JMDICT_URL) {
    super(url, { data: 'dictionaries/jmdict.txt.gz', meta: 'dictionaries/jmdict.json', download: 'dictionaries/jmdict.download.gz' });
  }

  protected async process(downloadPath: string): Promise<Processed<JmdictIndex>> {
    const file = await readStream(downloadPath);
    if (!file) throw new Error('Could not read the downloaded file');
    this.reportProcessing(0, file.size);
    let read = 0;
    let reported = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller) => {
        read += chunk.length;
        if (read - reported > file.size / 100) {
          reported = read;
          this.reportProcessing(read, file.size);
        }
        controller.enqueue(chunk);
      },
    });
    const text = file.stream
      .pipeThrough(counter)
      .pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>)
      .pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>);
    const parser = new JmdictParser();
    await forEachLine(text, (line) => parser.line(line));
    if (parser.entryCount < MIN_ENTRIES) throw new Error('The download does not look like JMdict');
    // Encoded via a Blob rather than one giant joined string, to keep peak memory down on phones.
    const parts: string[] = [];
    for (const line of parser.lines()) parts.push(line + '\n');
    const data = new Uint8Array(await new Blob(parts).arrayBuffer());
    parts.length = 0;
    const index = new JmdictIndex(data);
    return { data: index, entryCount: index.entryCount, version: index.created || null, store: await gzipBytes(data) };
  }

  protected async decode(stored: Uint8Array): Promise<JmdictIndex> {
    return new JmdictIndex(await gunzipBytes(stored));
  }

  /**
   * Entries for a word as written: itself first, then what it could be a conjugation of.
   * `asWritten` keeps only words written that way (a kanji word's bare reading isn't one).
   * A word that exists as written isn't also offered as a conjugation (これ isn't 凝る's imperative),
   * and conjugations of words written that way come before bare readings (いった: 行く, not 煎る).
   */
  matches(word: string, asWritten = false): JmdictMatch[] {
    const index = this.data;
    if (!index) return [];
    const out: JmdictMatch[] = [];
    const seen = new Set<number>();
    const add = (base: string, reasons: string[], written: boolean, keep: (e: JmdictEntry) => boolean) => {
      const key = index.find(base);
      if (!key || key.segmentable !== written) return;
      for (const id of key.entries) {
        if (seen.has(id)) continue;
        const entry = index.entry(id);
        if (!keep(entry)) continue;
        seen.add(id);
        out.push({ entry, base, reasons });
      }
    };
    const candidates = deinflect(word);
    // する after a noun that takes it (勉強する, 勉強しました): the noun is the word.
    if (word.length > 2 && word.endsWith('する')) candidates.unshift({ base: word, type: VS, reasons: [] });
    const pos = (e: JmdictEntry) => e.senses.flatMap((s) => s.pos);
    for (const written of asWritten ? [true] : [true, false]) {
      add(word, [], written, () => true);
      if (written && out.length) return out;
      for (const d of candidates) {
        add(d.base, d.reasons, written, (e) => matchesPos(d.type, d.base, pos(e)));
        if (d.type & VS && d.base.length > 2 && d.base.endsWith('する')) {
          add(d.base.slice(0, -2), d.reasons, written, (e) => pos(e).includes('vs'));
        }
      }
    }
    return out;
  }

  /** The key a written word is tracked under: its dictionary form as written, or null. */
  keyOf(word: string): string | null {
    return this.best(word)?.base ?? null;
  }

  /**
   * The first of matches(word, true), without decoding more than needed (the segmenter asks this
   * for every stretch of text it considers), cached until the dictionary changes.
   */
  private best(word: string): { base: string; common: boolean } | null {
    if (this.revision !== this.wordsRevision) {
      this.words.clear();
      this.wordsRevision = this.revision;
    }
    let found = this.words.get(word);
    if (found === undefined) {
      found = this.findBest(word);
      if (this.words.size > 50_000) this.words.clear();
      this.words.set(word, found);
    }
    return found;
  }

  private findBest(word: string): { base: string; common: boolean } | null {
    const index = this.data;
    if (!index) return null;
    const own = index.find(word);
    if (own?.segmentable) return { base: word, common: own.common };
    const fits = (base: string, keep: (pos: string[]) => boolean) => {
      const key = index.find(base);
      return key?.segmentable && key.entries.some((id) => keep(index.entry(id).senses.flatMap((s) => s.pos))) ? key : null;
    };
    const candidates = deinflect(word);
    if (word.length > 2 && word.endsWith('する')) candidates.unshift({ base: word, type: VS, reasons: [] });
    for (const d of candidates) {
      const verb = fits(d.base, (pos) => matchesPos(d.type, d.base, pos));
      if (verb) return { base: d.base, common: verb.common };
      const noun = d.base.slice(0, -2);
      const suru = d.type & VS && d.base.length > 2 && d.base.endsWith('する') ? fits(noun, (pos) => pos.includes('vs')) : null;
      if (suru) return { base: noun, common: suru.common };
    }
    return null;
  }

  // WordList, used by the segmenter (revision comes from DownloadedDictionary).
  has(word: string): boolean {
    return this.best(word) !== null;
  }

  /**
   * Splitting text prefers common words (可愛い | です | ね over 可愛 | いで | すね), and keeps a
   * katakana word the dictionary doesn't know (a name: メロス) in one piece.
   */
  cost(word: string): number | null {
    const best = this.best(word);
    if (best) return best.common ? COMMON_COST : WORD_COST;
    if (KATAKANA_WORD.test(word)) return UNKNOWN_KATAKANA_COST;
    // A character that isn't a word on its own: worse than any word.
    return [...word].length === 1 ? UNKNOWN_CHAR_COST : null;
  }

  maxLengthFrom(firstChar: string): number {
    const longest = this.data?.longestFrom(firstChar) ?? 0;
    return longest + INFLECTION_ROOM;
  }
}
