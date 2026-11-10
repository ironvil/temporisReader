/**
 * A language's English Wiktionary entries (kaikki.org extract), downloaded at runtime.
 *
 * The download is tens of MB gzipped (hundreds of MB of JSON). Installing streams through it once,
 * keeps a compact line per entry (see data.ts), sorts them and stores the result gzipped (French:
 * 60 MB download → 6 MB stored). The download itself is deleted afterwards.
 */
import { forEachLine, gunzipBytes, gzipBytes } from '../../download';
import { readStream } from '../../storage';
import { DownloadedDictionary, type Processed } from '../downloaded-dictionary';
import { sortLines, trimEntry, WiktionaryIndex, type WiktionaryEntry } from './data';

/** Sanity check so a captive-portal page or truncated file isn't installed as a dictionary. */
export const MIN_ENTRIES = 1000;

export interface WiktionaryConfig {
  /** Wiktionary language code, as in the dump's lang_code (e.g. "fr"). */
  code: string;
  /** English name, e.g. "French" (used in kaikki.org URLs and labels). */
  language: string;
  /** e.g. "60 MB". */
  downloadSize: string;
  /** e.g. "about 400,000 words and forms". */
  coverage: string;
  /** Defaults to kaikki.org's per-language extract. */
  url?: string;
}

/** kaikki.org's per-language extract of English Wiktionary. */
export const kaikkiUrl = (language: string) =>
  `https://kaikki.org/dictionary/${encodeURIComponent(language)}/kaikki.org-dictionary-${encodeURIComponent(language)}.jsonl.gz`;

export class WiktionaryDictionary extends DownloadedDictionary<WiktionaryIndex> {
  readonly id: string;
  readonly name: string;
  readonly shortName = 'WK';
  readonly description: string;
  readonly downloadSize: string;
  readonly license = 'CC BY-SA 4.0, Wiktionary contributors';
  readonly homepage: string;
  readonly code: string;

  constructor(config: WiktionaryConfig) {
    const base = `dictionaries/wiktionary-${config.code}`;
    super(config.url ?? kaikkiUrl(config.language), { data: `${base}.txt.gz`, meta: `${base}.json`, download: `${base}.download.gz` });
    this.code = config.code;
    this.id = `wiktionary-${config.code}`;
    this.name = `Wiktionary (${config.language})`;
    this.description = `${config.language} → English, ${config.coverage} (via kaikki.org)`;
    this.downloadSize = config.downloadSize;
    this.homepage = `https://kaikki.org/dictionary/${encodeURIComponent(config.language)}/`;
  }

  protected async process(downloadPath: string): Promise<Processed<WiktionaryIndex>> {
    const file = await readStream(downloadPath);
    if (!file) throw new Error('Could not read the downloaded file');
    this.reportProcessing(0, file.size);

    // Count compressed bytes as they're read, for the progress bar.
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
      const trimmed = trimEntry(raw as Parameters<typeof trimEntry>[0], this.code);
      if (trimmed) lines.push(trimmed);
    });
    if (lines.length < MIN_ENTRIES || bad > lines.length) throw new Error('The download does not look like the Wiktionary data');

    // Encoded via a Blob rather than one giant joined string, to keep peak memory down on phones.
    const sorted = sortLines(lines);
    lines.length = 0;
    const data = new Uint8Array(await new Blob(sorted.map((l) => l + '\n')).arrayBuffer());
    sorted.length = 0;
    const index = new WiktionaryIndex(data);
    return { data: index, entryCount: index.entryCount, store: await gzipBytes(data) };
  }

  protected async decode(stored: Uint8Array): Promise<WiktionaryIndex> {
    return new WiktionaryIndex(await gunzipBytes(stored));
  }

  has(word: string): boolean {
    return this.data?.has(word) ?? false;
  }

  entries(word: string): WiktionaryEntry[] {
    return this.data?.entries(word) ?? [];
  }
}
