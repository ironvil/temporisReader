/**
 * Shared plumbing for dictionaries downloaded at runtime (never bundled in the APK): the install
 * download, progress reporting, a metadata file that marks the install as complete, lazy loading
 * into memory, and removal. Subclasses only say how to turn the download into data (`process`)
 * and how to load what was stored (`decode`).
 */
import { downloadToFile } from '../download';
import { moveFile, readBytes, readJson, removeFile, writeBytes, writeJson } from '../storage';
import type { Dictionary, DictionaryState, InstallProgress } from './types';

interface Meta {
  entryCount: number;
  installedAt: number;
  version?: string | null;
}

/** What `process` produced from a download. */
export interface Processed<Data> {
  data: Data;
  entryCount: number;
  /** e.g. the dictionary's publication date, shown in settings. */
  version?: string | null;
  /** Bytes to store, or 'download' to keep the downloaded file as it is. */
  store: Uint8Array | 'download';
}

/** Storage paths. Existing installs depend on them, so they never change once released. */
export interface DictionaryFiles {
  /** The stored data. */
  data: string;
  /** Written last: its presence means the install completed. */
  meta: string;
  /** Where the download goes before it's processed. */
  download: string;
}

export abstract class DownloadedDictionary<Data> implements Dictionary {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly shortName: string;
  abstract readonly description: string;
  abstract readonly downloadSize: string;
  abstract readonly license: string;
  abstract readonly homepage: string;

  /** The loaded data, or null when not loaded (or not installed). */
  protected data: Data | null = null;
  private meta: Meta | null = null;
  private _revision = 0;
  private loading: Promise<boolean> | null = null;
  private installing: Promise<void> | null = null;
  private progress: InstallProgress | null = null;
  private readonly listeners = new Set<(p: InstallProgress) => void>();

  protected constructor(
    readonly url: string,
    private readonly files: DictionaryFiles,
  ) {}

  private get dataFile() {
    return this.files.data;
  }
  protected get downloadFile() {
    return this.files.download;
  }
  private get metaFile() {
    return this.files.meta;
  }

  /** Turns the downloaded file into data. Throw to reject a bad download. */
  protected abstract process(downloadPath: string): Promise<Processed<Data>>;
  /** Loads stored bytes (what `process` asked to store) back into data. */
  protected abstract decode(stored: Uint8Array): Promise<Data>;

  /** Reports processing progress (e.g. bytes of a big download parsed so far). */
  protected reportProcessing(bytes?: number, total?: number) {
    this.emit({ phase: 'processing', bytes, total });
  }

  async state(): Promise<DictionaryState> {
    const meta = await readJson<Meta>(this.metaFile);
    if (!meta) return { installed: false };
    return { installed: true, entryCount: meta.entryCount, installedAt: meta.installedAt, version: meta.version ?? undefined };
  }

  isReady(): boolean {
    return this.data !== null;
  }

  ensureLoaded(): Promise<boolean> {
    if (this.data) return Promise.resolve(true);
    this.loading ??= this.load().finally(() => (this.loading = null));
    return this.loading;
  }

  private async load(): Promise<boolean> {
    const meta = await readJson<Meta>(this.metaFile);
    if (!meta) return false;
    const bytes = await readBytes(this.dataFile);
    if (!bytes) return false;
    this.setData(await this.decode(bytes), meta);
    return true;
  }

  /** Changes whenever the data changes (loaded, updated, removed); invalidates caches. */
  get revision(): number {
    return this._revision;
  }

  /** Identifies the loaded data (for caches that outlive the session), or null when not loaded. */
  get dataKey(): string | null {
    return this.data && this.meta ? `${this.meta.entryCount}:${this.meta.version ?? this.meta.installedAt}` : null;
  }

  private setData(data: Data | null, meta: Meta | null) {
    this.data = data;
    this.meta = meta;
    this._revision++;
  }

  install(): Promise<void> {
    this.installing ??= this.runInstall().finally(() => (this.installing = null));
    return this.installing;
  }

  private async runInstall(): Promise<void> {
    try {
      this.emit({ phase: 'downloading', bytes: 0, total: 0 });
      await downloadToFile(this.url, this.downloadFile, ({ bytes, total }) => this.emit({ phase: 'downloading', bytes, total }));
      this.reportProcessing();
      const processed = await this.process(this.downloadFile);

      if (processed.store === 'download') await moveFile(this.downloadFile, this.dataFile);
      else {
        await writeBytes(this.dataFile, processed.store);
        await removeFile(this.downloadFile);
      }
      const meta: Meta = { entryCount: processed.entryCount, installedAt: Date.now(), version: processed.version ?? null };
      await writeJson(this.metaFile, meta);
      this.setData(processed.data, meta);
      this.emit({ phase: 'done' });
    } catch (err) {
      await removeFile(this.downloadFile);
      this.emit({ phase: 'error', error: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      this.progress = null;
    }
  }

  async uninstall(): Promise<void> {
    await removeFile(this.metaFile);
    await removeFile(this.dataFile);
    this.setData(null, null);
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
