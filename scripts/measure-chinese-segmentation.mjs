/**
 * Scores every Chinese segmenter (the Word splitting options) against hand-segmented
 * text: one sentence per line, words separated by spaces. The SIGHAN 2005 test sets work
 * (pku_test_gold.utf8, msr_test_gold.utf8 from icwb2-data). They're for research use only, so
 * they're not in the repo: download them yourself.
 *
 *   node --experimental-transform-types scripts/measure-chinese-segmentation.mjs cedict_1_0_ts_utf-8_mdbg.txt.gz gold.utf8 [gold2.utf8 …]
 *
 * Precision: share of the words it makes that are the reference's; recall: share of the
 * reference's words it finds; F1 combines them. Standards differ on what a word is (PKU and MSR
 * don't agree with each other, or with CC-CEDICT), so compare segmenters, not absolute scores.
 */
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

// The app's modules import without extensions (Vite resolves them); do the same here.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith('.') && !specifier.endsWith('.ts')) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { buildCedictIndex, simplifiedOf } = await import('../src/languages/zh/cedict-parse.ts');
const { parseHmm, parseWordCounts } = await import('../src/languages/zh/jieba/data.ts');
const { buildChineseSegmenter, CHINESE_SEGMENTERS } = await import('../src/languages/zh/segmenters.ts');

const [cedictPath, ...goldPaths] = process.argv.slice(2);
if (!cedictPath || !goldPaths.length) {
  console.error('Usage: node --experimental-transform-types scripts/measure-chinese-segmentation.mjs <cc-cedict .txt or .txt.gz> <gold.utf8>…');
  process.exit(1);
}
const text = (path) => {
  const bytes = readFileSync(path);
  return (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString('utf8');
};

const index = buildCedictIndex(text(cedictPath));
const dictionary = {
  revision: 1,
  has: (w) => index.lines.has(w),
  maxLengthFrom: (c) => index.maxLengthByFirstChar.get(c) ?? 0,
  simplifiedOf: (w) => simplifiedOf(index, w),
};
const jiebaDir = join(root, 'src/languages/zh/jieba');
const jieba = {
  words: parseWordCounts(text(join(jiebaDir, 'words.txt.gz')), (w) => index.lines.has(w)),
  hmm: parseHmm(text(join(jiebaDir, 'hmm.json.gz'))),
};

const variants = CHINESE_SEGMENTERS.map((o) => ({ name: o.label, id: o.id }));

for (const goldPath of goldPaths) {
  const sentences = text(goldPath).split('\n').map((l) => l.trim().split(/\s+/).filter(Boolean)).filter((words) => words.length);
  console.log(`\n${goldPath}: ${sentences.length} sentences, ${sentences.reduce((n, s) => n + s.length, 0)} words`);
  for (const { name, id } of variants) {
    const { segmenter } = buildChineseSegmenter(id, { dictionary, jieba });
    let correct = 0;
    let predicted = 0;
    let reference = 0;
    const started = performance.now();
    for (const words of sentences) {
      const sentence = words.join('');
      const gold = new Set();
      let at = 0;
      for (const w of words) gold.add(`${at}:${(at += w.length)}`);
      reference += gold.size;
      for (const s of segmenter.segment(sentence)) {
        predicted++;
        if (gold.has(`${s.start}:${s.end}`)) correct++;
      }
    }
    const ms = performance.now() - started;
    const p = correct / predicted;
    const r = correct / reference;
    const f = (2 * p * r) / (p + r);
    const pct = (n) => `${(n * 100).toFixed(1)}%`.padStart(6);
    console.log(`  ${name.padEnd(32)} P ${pct(p)}  R ${pct(r)}  F1 ${pct(f)}  ${Math.round(ms)} ms`);
  }
}
