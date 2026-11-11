// Fails if packages/book-parser changed without a PARSER_VERSION bump. Compares the working tree
// (committed or not) with where this branch left `main`, or with the ref given as an argument:
//   npm run check:parser-version [-- <base-ref>]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PACKAGE = 'packages/book-parser';
const VERSION_FILE = `${PACKAGE}/src/version.ts`;
const base = process.argv[2] ?? 'main';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const versionIn = (source) => Number(/PARSER_VERSION\s*=\s*(\d+)/.exec(source)?.[1]);

const since = git('merge-base', base, 'HEAD');
const changed = [
  ...git('diff', '--name-only', since, '--', PACKAGE).split('\n'),
  ...git('ls-files', '--others', '--exclude-standard', '--', PACKAGE).split('\n'),
].filter((f) => f && f !== VERSION_FILE);

let before;
try {
  before = versionIn(git('show', `${since}:${VERSION_FILE}`));
} catch {
  console.log(`${VERSION_FILE} is new since ${base}: nothing to compare.`);
  process.exit(0);
}
const now = versionIn(readFileSync(VERSION_FILE, 'utf8'));

if (!changed.length) {
  console.log(`Parser unchanged since ${base} (version ${now}).`);
} else if (now > before) {
  console.log(`Parser changed and PARSER_VERSION was bumped (${before} → ${now}).`);
} else {
  console.error(`The parser changed since ${base} but PARSER_VERSION is still ${now}:`);
  for (const f of changed) console.error(`  ${f}`);
  console.error(`Bump it in ${VERSION_FILE} if books may get different paragraphs, headings or chapters.`);
  process.exit(1);
}
