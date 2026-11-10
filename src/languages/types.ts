import type { WordSegmenter } from '../segmentation/types';

/**
 * Contract every supported language implements. The reader only talks to these
 * interfaces, so adding a language means adding a module under src/languages/<id>/
 * and registering it in src/languages/index.ts.
 */

export interface LookupNotice {
  kind: 'missing-dictionary' | 'not-found' | 'error';
  message: string;
}

export interface LookupResult<Entry = unknown> {
  /** Range of the matched word within the paragraph (UTF-16 offsets, end exclusive). */
  start: number;
  end: number;
  /** The word's known-words key (see wordKey); also what the popup's status buttons change. */
  headword: string;
  entries: Entry[];
  /** Short label for the dictionary that answered, shown on the popup (e.g. "CC"). */
  source?: string;
  /** Set when there are no entries to show. */
  notice?: LookupNotice;
}

export type DictionaryState =
  | { installed: false }
  | { installed: true; entryCount: number; installedAt: number; version?: string };

export interface InstallProgress {
  phase: 'downloading' | 'processing' | 'done' | 'error';
  /** Bytes downloaded so far / expected total (0 when unknown). */
  bytes?: number;
  total?: number;
  error?: string;
}

/** A dictionary that is downloaded on demand and kept out of the APK. */
export interface Dictionary {
  id: string;
  name: string;
  /** Badge shown on lookup popups. */
  shortName: string;
  description: string;
  downloadSize: string;
  license: string;
  homepage: string;

  state(): Promise<DictionaryState>;
  /** Downloads and installs (or updates). Concurrent calls share one download. */
  install(): Promise<void>;
  uninstall(): Promise<void>;
  /** Current install progress, or null when no install is running. */
  installProgress(): InstallProgress | null;
  /** Subscribe to install progress. Returns an unsubscribe function. */
  onProgress(listener: (progress: InstallProgress) => void): () => void;

  /** True when loaded into memory and ready for lookups. */
  isReady(): boolean;
  /** Loads an installed dictionary into memory. Resolves false if not installed. */
  ensureLoaded(): Promise<boolean>;
}

export interface LanguageModule<Entry = unknown> {
  /** BCP 47 language code, also stored on each book. */
  id: string;
  name: string;
  nativeName: string;
  /** Value for the `lang` attribute on rendered text (affects fonts and line breaking). */
  htmlLang: string;
  /** A short sentence in the language, for the text-size preview in settings. */
  sampleText: string;
  dictionaries: Dictionary[];
  /** Splits paragraphs into words: used for lookup spans and progress word positions. */
  segmenter: WordSegmenter;

  /** Rough confidence 0..1 that `sample` is written in this language. */
  detect(sample: string): number;
  /** True when lookups can be answered without waiting for a dictionary to load. */
  ready(): boolean;
  /**
   * The key a segmented word is tracked under in the known-words list, or null when it can't be
   * tracked (no dictionary entry). Chinese uses the word itself; French uses the dictionary form
   * (mangeaient → manger). Must return null while dictionaries aren't loaded, so pages are never
   * bulk-marked from guesses.
   */
  wordKey(word: string): string | null;
  /**
   * Identifies the data segmentation and wordKey depend on (e.g. dictionary version), or null
   * while it isn't loaded. Cached per-book word counts are rebuilt when it changes.
   */
  segmentationKey(): string | null;
  /**
   * Finds the word at `index` in `paragraph` and looks it up.
   * Returns null when the tapped character isn't part of a word (punctuation, spaces…).
   */
  lookup(paragraph: string, index: number): Promise<LookupResult<Entry> | null>;
  /** Renders dictionary entries for the popup. Each language decides its own layout. */
  renderEntries(result: LookupResult<Entry>): HTMLElement;
}
