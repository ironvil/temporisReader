/** Loads the bundled jieba data (an asset in the app, so no download). */
import { parseHmm, parseWordCounts, type HmmModel, type WordCounts } from './data';

export interface JiebaData {
  readonly words: WordCounts;
  readonly hmm: HmmModel;
}

async function asset(url: URL): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url.pathname}: HTTP ${response.status}`);
  return response.text();
}

/** `keep`: which words' counts to hold in memory (the segmenter only asks about dictionary words). */
export async function loadJieba(keep: (word: string) => boolean): Promise<JiebaData> {
  // Plain text, not .gz: Android's build decompresses .gz assets and renames them (scripts/build-jieba-data.mjs).
  const [words, hmm] = await Promise.all([
    asset(new URL('./words.txt', import.meta.url)),
    asset(new URL('./hmm.json', import.meta.url)),
  ]);
  return { words: parseWordCounts(words, keep), hmm: parseHmm(hmm) };
}
