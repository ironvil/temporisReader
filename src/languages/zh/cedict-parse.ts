/** Pure CC-CEDICT parsing. Format: `傳統 传统 [chuan2 tong3] /tradition/traditional/` */

export interface CedictEntry {
  traditional: string;
  simplified: string;
  /** Numbered pinyin, e.g. "chuan2 tong3". */
  pinyin: string;
  definitions: string[];
}

export interface CedictIndex {
  /** Headword (simplified and traditional) → raw lines. Lines are parsed lazily on lookup. */
  lines: Map<string, string[]>;
  entryCount: number;
  /** Longest headword, in UTF-16 units. */
  maxLength: number;
  /** Publication date from the file header, if present. */
  date: string | null;
}

const LINE = /^(\S+) (\S+) \[([^\]]*)\] \/(.*)\/\s*$/;

export function parseCedictLine(line: string): CedictEntry | null {
  const m = LINE.exec(line);
  if (!m) return null;
  return {
    traditional: m[1],
    simplified: m[2],
    pinyin: m[3],
    definitions: m[4].split('/').filter(Boolean),
  };
}

export function buildCedictIndex(text: string): CedictIndex {
  const lines = new Map<string, string[]>();
  let entryCount = 0;
  let maxLength = 1;
  let date: string | null = null;

  const add = (key: string, line: string) => {
    const list = lines.get(key);
    if (list) list.push(line);
    else lines.set(key, [line]);
  };

  let pos = 0;
  while (pos < text.length) {
    let end = text.indexOf('\n', pos);
    if (end < 0) end = text.length;
    let line = text.slice(pos, end);
    pos = end + 1;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line) continue;
    if (line[0] === '#') {
      const d = /^#!\s*date=(\S+)/.exec(line);
      if (d) date = d[1];
      continue;
    }
    const sp1 = line.indexOf(' ');
    const sp2 = line.indexOf(' ', sp1 + 1);
    if (sp1 <= 0 || sp2 <= sp1 + 1 || line[sp2 + 1] !== '[') continue;

    const traditional = line.slice(0, sp1);
    const simplified = line.slice(sp1 + 1, sp2);
    add(simplified, line);
    if (traditional !== simplified) add(traditional, line);
    entryCount++;
    maxLength = Math.max(maxLength, simplified.length, traditional.length);
  }
  return { lines, entryCount, maxLength, date };
}

/**
 * Entries for `word`, best first: entries whose simplified/traditional form matches exactly in the
 * same script as the query, then common words before proper nouns (capitalised pinyin).
 */
export function lookupCedict(index: CedictIndex, word: string): CedictEntry[] {
  const raw = index.lines.get(word);
  if (!raw) return [];
  const entries = raw.map(parseCedictLine).filter((e): e is CedictEntry => e !== null);
  const score = (e: CedictEntry) => (e.simplified === word ? 0 : 2) + (/^[A-Z]/.test(e.pinyin) ? 1 : 0);
  return entries.sort((a, b) => score(a) - score(b));
}
