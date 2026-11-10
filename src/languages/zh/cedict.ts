/** CC-CEDICT, downloaded from MDBG at runtime (never bundled in the APK). */
import { downloadToFile, gunzipText } from '../../download';
import { moveFile, readBytes, readJson, removeFile, writeJson } from '../../storage';
import type { WordList } from '../../segmentation/dictionary';
import type { Dictionary, DictionaryState, InstallProgress } from '../types';
import { buildCedictIndex, lookupCedict, type CedictEntry, type CedictIndex } from './cedict-parse';

export const CEDICT_URL = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz';

const DATA_FILE = 'dictionaries/cc-cedict.txt.gz';
const TEMP_FILE = 'dictionaries/cc-cedict.download.gz';
const META_FILE = 'dictionaries/cc-cedict.json';
/** Sanity check so a captive-portal page or truncated file isn't installed as a dictionary. */
const MIN_ENTRIES = 1000;

interface Meta {
  entryCount: number;
  installedAt: number;
  version: string | null;
}

export class CedictDictionary implements Dictionary, WordList {
  readonly id = 'cc-cedict';
  readonly name = 'CC-CEDICT';
  readonly shortName = 'CC';
  readonly description = 'Chinese → English, about 120,000 entries';
  readonly downloadSize = '4 MB';
  readonly license = 'CC BY-SA 4.0, MDBG';
  readonly homepage = 'https://www.mdbg.net/chinese/dictionary?page=cc-cedict';

  private index: CedictIndex | null = null;
  private _revision = 0;
  private loading: Promise<boolean> | null = null;
  private installing: Promise<void> | null = null;
  private progress: InstallProgress | null = null;
  private listeners = new Set<(p: InstallProgress) => void>();

  constructor(private readonly url = CEDICT_URL) {}

  async state(): Promise<DictionaryState> {
    const meta = await readJson<Meta>(META_FILE);
    if (!meta) return { installed: false };
    return { installed: true, entryCount: meta.entryCount, installedAt: meta.installedAt, version: meta.version ?? undefined };
  }

  isReady(): boolean {
    return this.index !== null;
  }

  ensureLoaded(): Promise<boolean> {
    if (this.index) return Promise.resolve(true);
    this.loading ??= this.load().finally(() => (this.loading = null));
    return this.loading;
  }

  private async load(): Promise<boolean> {
    if (!(await readJson<Meta>(META_FILE))) return false;
    const bytes = await readBytes(DATA_FILE);
    if (!bytes) return false;
    this.setIndex(buildCedictIndex(await gunzipText(bytes)));
    return true;
  }

  lookup(word: string): CedictEntry[] {
    return this.index ? lookupCedict(this.index, word) : [];
  }

  // WordList, used by the segmenter.
  get revision(): number {
    return this._revision;
  }

  has(word: string): boolean {
    return this.index?.lines.has(word) ?? false;
  }

  maxLengthFrom(firstChar: string): number {
    return this.index?.maxLengthByFirstChar.get(firstChar) ?? 0;
  }

  /** Identifies the loaded data, or null when not loaded. */
  get dataKey(): string | null {
    return this.index ? `${this.index.entryCount}:${this.index.date ?? ''}` : null;
  }

  private setIndex(index: CedictIndex | null) {
    this.index = index;
    this._revision++;
  }

  install(): Promise<void> {
    this.installing ??= this.runInstall().finally(() => (this.installing = null));
    return this.installing;
  }

  private async runInstall(): Promise<void> {
    try {
      this.emit({ phase: 'downloading', bytes: 0, total: 0 });
      await downloadToFile(this.url, TEMP_FILE, ({ bytes, total }) => this.emit({ phase: 'downloading', bytes, total }));

      this.emit({ phase: 'processing' });
      const bytes = await readBytes(TEMP_FILE);
      if (!bytes) throw new Error('Could not read the downloaded file');
      const index = buildCedictIndex(await gunzipText(bytes));
      if (index.entryCount < MIN_ENTRIES) throw new Error('The download does not look like CC-CEDICT');

      await moveFile(TEMP_FILE, DATA_FILE);
      await writeJson(META_FILE, { entryCount: index.entryCount, installedAt: Date.now(), version: index.date } satisfies Meta);
      this.setIndex(index);
      this.emit({ phase: 'done' });
    } catch (err) {
      await removeFile(TEMP_FILE);
      this.emit({ phase: 'error', error: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      this.progress = null;
    }
  }

  async uninstall(): Promise<void> {
    await removeFile(META_FILE);
    await removeFile(DATA_FILE);
    this.setIndex(null);
  }

  installProgress(): InstallProgress | null {
    return this.progress;
  }

  onProgress(listener: (p: InstallProgress) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(p: InstallProgress) {
    this.progress = p;
    this.listeners.forEach((l) => l(p));
  }
}
