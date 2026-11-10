/** Converts CC-CEDICT numbered pinyin ("tou2 fa5") to tone-marked pinyin ("tóufa"). */

const TONE_MARKS: Record<string, string> = {
  a: 'āáǎà',
  e: 'ēéěè',
  i: 'īíǐì',
  o: 'ōóǒò',
  u: 'ūúǔù',
  ü: 'ǖǘǚǜ',
};

export interface Syllable {
  text: string;
  /** 1–4, 5 for neutral, 0 when the token isn't a toned syllable (punctuation, letters). */
  tone: number;
}

export function parseSyllable(raw: string): Syllable {
  const normalised = raw.replace(/u:/g, 'ü').replace(/U:/g, 'Ü').replace(/v/g, 'ü');
  const m = /^([A-Za-zÜü]+)([1-5])$/.exec(normalised);
  if (!m) return { text: raw.replace(/u:/g, 'ü').replace(/U:/g, 'Ü'), tone: 0 };

  const body = m[1];
  const tone = Number(m[2]);
  if (tone === 5) return { text: body, tone };

  const lower = body.toLowerCase();
  let pos = lower.search(/[ae]/);
  if (pos < 0) pos = lower.indexOf('ou');
  if (pos < 0) {
    for (let i = lower.length - 1; i >= 0; i--) {
      if ('iouü'.includes(lower[i])) {
        pos = i;
        break;
      }
    }
  }
  if (pos < 0) return { text: body, tone }; // e.g. "m2", "ng4"

  let marked = TONE_MARKS[lower[pos]][tone - 1];
  if (body[pos] !== lower[pos]) marked = marked.toUpperCase();
  return { text: body.slice(0, pos) + marked + body.slice(pos + 1), tone };
}

export function pinyinSyllables(numbered: string): Syllable[] {
  return numbered.split(/\s+/).filter(Boolean).map(parseSyllable);
}

/** Joins syllables into words, adding an apostrophe before a/e/o syllables (xī'ān). */
export function formatPinyin(numbered: string): string {
  const syllables = pinyinSyllables(numbered);
  let out = '';
  syllables.forEach((s, i) => {
    if (i > 0) {
      const joined = s.tone > 0 && syllables[i - 1].tone > 0;
      if (!joined) out += ' ';
      else if (/^[aeoāáǎàēéěèōóǒò]/i.test(s.text)) out += "'";
    }
    out += s.text;
  });
  return out;
}

/** Converts bracketed numbered pinyin inside definitions: "variant of 著[zhuo2]" → "variant of 著[zhuó]". */
export function formatInlinePinyin(definition: string): string {
  return definition.replace(/\[((?:[A-Za-z:]+[1-5]\s*)+)\]/g, (_, p: string) => `[${formatPinyin(p)}]`);
}
