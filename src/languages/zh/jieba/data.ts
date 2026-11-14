/**
 * jieba's data (MIT, https://github.com/fxsjy/jieba, see LICENSE here), bundled with the app:
 * word counts from its corpus and its hidden Markov model for words it doesn't know.
 * Built by scripts/build-jieba-data.mjs. Pure parsing only, so it also runs in Node (scripts).
 */

/** The jieba commit the data comes from. Part of the segmentation key: change it with the data. */
export const JIEBA_VERSION = '67fa2e3';

export type { HmmModel } from '../../../segmentation/unknown-words';
export type { WordFrequencies as WordCounts } from '../../../segmentation/frequency';
import type { HmmModel } from '../../../segmentation/unknown-words';
import type { WordFrequencies as WordCounts } from '../../../segmentation/frequency';

/**
 * Parses words.txt ("word count" per line), keeping the words `keep` accepts and every single
 * character (any character can be a word, dictionary entry or not).
 */
export function parseWordCounts(text: string, keep: (word: string) => boolean = () => true): WordCounts {
  const counts = new Map<string, number>();
  let total = 0;
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const space = text.indexOf(' ', start);
    if (space > start && space < end) {
      const count = Number(text.slice(space + 1, end));
      total += count;
      const word = text.slice(start, space);
      if (space - start === 1 || (space - start === 2 && word.codePointAt(0)! > 0xffff) || keep(word)) counts.set(word, count);
    }
    start = end + 1;
  }
  return { counts, total };
}

export function parseHmm(json: string): HmmModel {
  const model = JSON.parse(json) as HmmModel;
  if (!model.emit?.S || !model.start || !model.trans) throw new Error('Not a jieba HMM file');
  return model;
}
