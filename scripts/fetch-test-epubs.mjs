/**
 * Downloads the EPUBs the tests read into `tests/test epubs/` (git-ignored: they aren't ours to
 * redistribute, and keeping them out of the repo keeps it small). Each file is checked against its
 * SHA-256, since the tests expect exact chapter counts and text; files already present and correct
 * are skipped.
 *
 *   npm run setup:test-books
 *
 * The Chinese HPMOR translation has no public download we know of. Put a copy in the folder by hand
 * (name and checksum below); without it the tests that need it are skipped.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'test epubs');

const books = [
  // Project Gutenberg (public domain). Gutenberg regenerates its EPUBs now and then; if a checksum
  // stops matching, check the tests still pass with the new file, then update the hash here.
  {
    name: 'pg2229-images-3.epub', // Goethe, Faust
    url: 'https://www.gutenberg.org/cache/epub/2229/pg2229-images-3.epub',
    sha256: 'c9f43aa402c72e24e7fb9c0090b89206cd29b649eb93b561cf3e5d8eace055b4',
  },
  {
    name: 'pg6343-images-3.epub', // Kant
    url: 'https://www.gutenberg.org/cache/epub/6343/pg6343-images-3.epub',
    sha256: '8166ea701447ad09506f1458f60ed949839041710429b880785a7bb843740cda',
  },
  {
    name: 'pg17989-images-3.epub', // Dumas, Le comte de Monte-Cristo
    url: 'https://www.gutenberg.org/cache/epub/17989/pg17989-images-3.epub',
    sha256: 'ac7037c7e4998f7f3fe77b54779809be443751ae18fa3f9673a6ad05df74a46e',
  },
  // Harry Potter and the Methods of Rationality, Eliezer Yudkowsky: the hpmor-book project's build.
  {
    name: 'hpmor.epub',
    url: 'https://github.com/hpmor-book/hpmor/releases/download/v1.2.15b/hpmor.epub',
    sha256: '2914b8e6e8f15e5183c088323b73fc755633075173ab0839d3888a36310344ce',
  },
  // 哈利·波特与理性之道 (Chinese HPMOR, hpmor翻译组, Calibre conversion): copy in by hand.
  {
    name: 'Ha Li _Bo Te Yu Li Xing Zhi Dao - Eliezer Yudkowsky.epub',
    sha256: '7c573ff582e07e9bbffa86aeeb0885284e50d02422a8ab9ade3e11420e97d519',
  },
];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

mkdirSync(dir, { recursive: true });
let failed = false;
for (const book of books) {
  const path = join(dir, book.name);
  if (existsSync(path) && sha256(readFileSync(path)) === book.sha256) {
    console.log(`ok          ${book.name}`);
    continue;
  }
  if (!book.url) {
    console.log(`not found   ${book.name}\n            No public download; copy it in by hand. Tests that need it are skipped.`);
    continue;
  }
  const response = await fetch(book.url);
  if (!response.ok) {
    console.error(`FAILED      ${book.name}: HTTP ${response.status} from ${book.url}`);
    failed = true;
    continue;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const hash = sha256(bytes);
  if (hash !== book.sha256) {
    console.error(`FAILED      ${book.name}: checksum ${hash} doesn't match (the source may have been updated)`);
    failed = true;
    continue;
  }
  writeFileSync(path, bytes);
  console.log(`downloaded  ${book.name}`);
}
process.exitCode = failed ? 1 : 0;
