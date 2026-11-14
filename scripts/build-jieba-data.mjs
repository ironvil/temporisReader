/**
 * Builds the bundled Chinese segmentation data from jieba (MIT, https://github.com/fxsjy/jieba)
 * at a pinned commit, into src/languages/zh/jieba/:
 *   words.txt.gz  "word count" per line: how often each all-Han word occurs in jieba's corpus
 *   hmm.json.gz   jieba's hidden Markov model for words it doesn't know (start, transition and
 *                 emission log probabilities for the B/M/E/S states: begin, middle, end, single)
 *   LICENSE       jieba's licence, which has to travel with the data
 *
 *   node scripts/build-jieba-data.mjs
 *
 * The output is committed; run this again only to move to another jieba commit (then bump
 * JIEBA_VERSION in src/languages/zh/jieba/data.ts, so cached word counts are rebuilt).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const COMMIT = '67fa2e36e72f69d9134b8a1037b83fbb070b9775';
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'languages', 'zh', 'jieba');

async function fetchText(path) {
  const url = `https://raw.githubusercontent.com/fxsjy/jieba/${COMMIT}/${path}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

/** jieba's model files are Python dict literals; with double quotes they're JSON (\u escapes included). */
function pythonDict(source) {
  const literal = source.slice(source.indexOf('P=') + 2).replaceAll("'", '"');
  return JSON.parse(literal);
}

const round = (n) => Math.max(Math.round(n * 1e4) / 1e4, -1e9); // -3.14e+100 ("impossible") → -1e9

const [dict, start, trans, emit, licence] = await Promise.all([
  fetchText('jieba/dict.txt'),
  fetchText('jieba/finalseg/prob_start.py'),
  fetchText('jieba/finalseg/prob_trans.py'),
  fetchText('jieba/finalseg/prob_emit.py'),
  fetchText('LICENSE'),
]);

const HAN = /^\p{Script=Han}+$/u;
const words = [];
for (const line of dict.split('\n')) {
  const [word, count] = line.split(' ');
  if (word && HAN.test(word) && Number(count) > 0) words.push(`${word} ${Number(count)}`);
}

const roundAll = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? round(v) : roundAll(v)]));
const hmm = { start: roundAll(pythonDict(start)), trans: roundAll(pythonDict(trans)), emit: roundAll(pythonDict(emit)) };

mkdirSync(out, { recursive: true });
const wordsGz = gzipSync(words.join('\n') + '\n', { level: 9 });
const hmmGz = gzipSync(JSON.stringify(hmm), { level: 9 });
writeFileSync(join(out, 'words.txt.gz'), wordsGz);
writeFileSync(join(out, 'hmm.json.gz'), hmmGz);
writeFileSync(join(out, 'LICENSE'), licence);
console.log(`jieba ${COMMIT.slice(0, 7)}: ${words.length} words (${(wordsGz.length / 1e6).toFixed(2)} MB), HMM ${Object.keys(hmm.emit.S).length} characters (${(hmmGz.length / 1e3).toFixed(0)} kB)`);
