/**
 * French → English Wiktionary (kaikki.org extract), downloaded at runtime and never bundled.
 *
 * The download is ~60 MB gzipped (~600 MB of JSON). Installing streams through it once, keeps a
 * compact line per entry (see wiktionary-data.ts), sorts them and stores ~6 MB gzipped. The
 * download itself is deleted afterwards.
 */
import { downloadToFile, forEachLine, gunzipBytes, gzipBytes } from '../../download';
import { readBytes, readJson, readStream, removeFile, writeBytes, writeJson } from '../../storage';
import type { Dictionary, DictionaryState, InstallProgress } from '../types';
import { sortLines, trimEntry, WiktionaryIndex, type WiktionaryEntry } from './wiktionary-data';

export const WIKTIONARY_FR_URL = 'https://kaikki.org/dictionary/French/kaikki.org-dictionary-French.jsonl.gz';

const DATA_FILE = 'dictionaries/wiktionary-fr.txt.gz';
const TEMP_FILE = 'dictionaries/wiktionary-fr.download.gz';
const META_FILE = 'dictionaries/wiktionary-fr.json';
/** Sanity check so a captive-portal page or truncated file isn't installed as a dictionary. */
export const MIN_ENTRIES = 1000;

interface Meta {
  entryCount: number;
  installedAt: number;
}

export class WiktionaryDictionary implements Dictionary {
  readonly id = 'wiktionary-fr';
  readonly name = 'Wiktionary (French)';
  readonly shortName = 'WK';
  readonly description = 'French → English, about 400,000 words and forms (via kaikki.org)';
  readonly downloadSize = '60 MB';
  readonly license = 'CC BY-SA 4.0, Wiktionary contributors';
  readonly homepage = 'https://kaikki.org/dictionary/French/';

  private index: WiktionaryIndex | null = null;
  private _revision = 0;
  private loadedAt = 0;
  private loading: Promise<boolean> | null = null;
  private installing: Promise<void> | null = null;
  private progress: InstallProgress | null = null;
  private listeners = new Set<(p: InstallProgress) => void>();

  constructor(private readonly url = WIKTIONARY_FR_URL) {}

  async state(): Promise<DictionaryState> {
    const meta = await readJson<Meta>(META_FILE);
    if (!meta) return { installed: false };
    return { installed: true, entryCount: meta.entryCount, installedAt: meta.installedAt };
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
    const meta = await readJson<Meta>(META_FILE);
    if (!meta) return false;
    const bytes = await readBytes(DATA_FILE);
    if (!bytes) return false;
    this.setIndex(new WiktionaryIndex(await gunzipBytes(bytes)), meta.installedAt);
    return true;
  }

  /** Changes whenever the data changes (loaded, updated, removed); invalidates caches. */
  get revision(): number {
    return this._revision;
  }

  /** Identifies the loaded data, or null when not loaded. */
  get dataKey(): string | null {
    return this.index ? `${this.index.entryCount}:${this.loadedAt}` : null;
  }

  has(word: string): boolean {
    return this.index?.has(word) ?? false;
  }

  entries(word: string): WiktionaryEntry[] {
    return this.index?.entries(word) ?? [];
  }

  private setIndex(index: WiktionaryIndex | null, installedAt = 0) {
    this.index = index;
    this.loadedAt = installedAt;
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

      const file = await readStream(TEMP_FILE);
      if (!file) throw new Error('Could not read the downloaded file');
      this.emit({ phase: 'processing', bytes: 0, total: file.size });

      // Count compressed bytes as they're read, for the progress bar.
      let read = 0;
      let reported = 0;
      const counter = new TransformStream<Uint8Array, Uint8Array>({
        transform: (chunk, controller) => {
          read += chunk.length;
          if (read - reported > file.size / 100) {
            reported = read;
            this.emit({ phase: 'processing', bytes: read, total: file.size });
          }
          controller.enqueue(chunk);
        },
      });
      const text = file.stream
        .pipeThrough(counter)
        .pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>)
        .pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>);

      const lines: string[] = [];
      let bad = 0;
      await forEachLine(text, (line) => {
        if (!line) return;
        let raw: unknown;
        try {
          raw = JSON.parse(line);
        } catch {
          bad++;
          return;
        }
        const trimmed = trimEntry(raw as Parameters<typeof trimEntry>[0]);
        if (trimmed) lines.push(trimmed);
      });
      if (lines.length < MIN_ENTRIES || bad > lines.length) throw new Error('The download does not look like the Wiktionary data');

      // Encoded via a Blob rather than one giant joined string, to keep peak memory down on phones.
      const sorted = sortLines(lines);
      lines.length = 0;
      const data = new Uint8Array(await new Blob(sorted.map((l) => l + '\n')).arrayBuffer());
      sorted.length = 0;
      await writeBytes(DATA_FILE, await gzipBytes(data));
      await removeFile(TEMP_FILE);
      const installedAt = Date.now();
      const index = new WiktionaryIndex(data);
      await writeJson(META_FILE, { entryCount: index.entryCount, installedAt } satisfies Meta);
      this.setIndex(index, installedAt);
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
