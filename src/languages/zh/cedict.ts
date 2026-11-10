/** CC-CEDICT, downloaded from MDBG at runtime (never bundled in the APK). */
import { gunzipText } from '../../download';
import { readBytes } from '../../storage';
import type { WordList } from '../../segmentation/dictionary';
import { DownloadedDictionary, type Processed } from '../downloaded-dictionary';
import { buildCedictIndex, lookupCedict, type CedictEntry, type CedictIndex } from './cedict-parse';

export const CEDICT_URL = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz';

/** Sanity check so a captive-portal page or truncated file isn't installed as a dictionary. */
const MIN_ENTRIES = 1000;

export class CedictDictionary extends DownloadedDictionary<CedictIndex> implements WordList {
  readonly id = 'cc-cedict';
  readonly name = 'CC-CEDICT';
  readonly shortName = 'CC';
  readonly description = 'Chinese → English, about 120,000 entries';
  readonly downloadSize = '4 MB';
  readonly license = 'CC BY-SA 4.0, MDBG';
  readonly homepage = 'https://www.mdbg.net/chinese/dictionary?page=cc-cedict';

  constructor(url = CEDICT_URL) {
    super(url, { data: 'dictionaries/cc-cedict.txt.gz', meta: 'dictionaries/cc-cedict.json', download: 'dictionaries/cc-cedict.download.gz' });
  }

  protected async process(downloadPath: string): Promise<Processed<CedictIndex>> {
    const bytes = await readBytes(downloadPath);
    if (!bytes) throw new Error('Could not read the downloaded file');
    const index = await this.decode(bytes);
    if (index.entryCount < MIN_ENTRIES) throw new Error('The download does not look like CC-CEDICT');
    // The download is already compact: keep it as it is.
    return { data: index, entryCount: index.entryCount, version: index.date, store: 'download' };
  }

  protected async decode(stored: Uint8Array): Promise<CedictIndex> {
    return buildCedictIndex(await gunzipText(stored));
  }

  lookup(word: string): CedictEntry[] {
    return this.data ? lookupCedict(this.data, word) : [];
  }

  // WordList, used by the segmenter (revision comes from DownloadedDictionary).
  has(word: string): boolean {
    return this.data?.lines.has(word) ?? false;
  }

  maxLengthFrom(firstChar: string): number {
    return this.data?.maxLengthByFirstChar.get(firstChar) ?? 0;
  }
}
