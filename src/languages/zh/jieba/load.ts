/** Loads the bundled jieba data (an asset in the app, so no download). */
import { gunzipText } from '../../../download';
import { parseHmm, parseWordCounts, type HmmModel, type WordCounts } from './data';

export interface JiebaData {
  readonly words: WordCounts;
  readonly hmm: HmmModel;
}

async function asset(url: URL): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url.pathname}: HTTP ${response.status}`);
  // gunzipText passes the text through if a server already decoded it.
  return gunzipText(new Uint8Array(await response.arrayBuffer()));
}

/** `keep`: which words' counts to hold in memory (the segmenter only asks about dictionary words). */
export async function loadJieba(keep: (word: string) => boolean): Promise<JiebaData> {
  const [words, hmm] = await Promise.all([
    asset(new URL('./words.txt.gz', import.meta.url)),
    asset(new URL('./hmm.json.gz', import.meta.url)),
  ]);
  return { words: parseWordCounts(words, keep), hmm: parseHmm(hmm) };
}
