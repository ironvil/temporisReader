/**
 * Measures the trimmed French Wiktionary data the app builds on install:
 *   node scripts/measure-wiktionary.mjs path/to/kaikki.org-dictionary-French.jsonl.gz [out.txt]
 */
import { createReadStream, writeFileSync } from 'node:fs';
import { createGunzip, gzipSync } from 'node:zlib';
import { createInterface } from 'node:readline';
import { sortLines, trimEntry, WiktionaryIndex } from '../src/languages/fr/wiktionary-data.ts';

const [input, out] = process.argv.slice(2);
const started = Date.now();
const lines = [];
let read = 0;
for await (const line of createInterface({ input: createReadStream(input).pipe(createGunzip()), crlfDelay: Infinity })) {
  if (!line) continue;
  read++;
  const trimmed = trimEntry(JSON.parse(line));
  if (trimmed) lines.push(trimmed);
}
const text = sortLines(lines).join('\n') + '\n';
const bytes = Buffer.byteLength(text);
const gz = gzipSync(text).length;
const index = new WiktionaryIndex(Buffer.from(text));
console.log({ read, kept: lines.length, mb: (bytes / 1e6).toFixed(1), gzMb: (gz / 1e6).toFixed(1), seconds: (Date.now() - started) / 1000 });
for (const w of ['mangeaient', 'manger', 'maison', 'est', 'livre', "aujourd'hui", 'peut-être', 'belles', 'Paris']) console.log(w, JSON.stringify(index.entries(w)).slice(0, 300));
if (out) writeFileSync(out, text);
