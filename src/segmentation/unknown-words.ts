import type { WordSegmenter, WordSpan } from './types';

/** B(egin), M(iddle), E(nd) of a word, or a S(ingle)-character word. */
export type HmmState = 'B' | 'M' | 'E' | 'S';

/** A character-tagging hidden Markov model (log probabilities; missing entries are impossible). */
export interface HmmModel {
  readonly start: Readonly<Record<HmmState, number>>;
  readonly trans: Readonly<Record<HmmState, Readonly<Partial<Record<HmmState, number>>>>>;
  readonly emit: Readonly<Record<HmmState, Readonly<Record<string, number>>>>;
}

const STATES: readonly HmmState[] = ['B', 'M', 'E', 'S'];
/** States each state can follow. */
const PREVIOUS: Readonly<Record<HmmState, readonly HmmState[]>> = { B: ['E', 'S'], M: ['M', 'B'], E: ['B', 'M'], S: ['S', 'E'] };
/** "Impossible", but finite, so paths through a character the model never saw still compare. */
const IMPOSSIBLE = -1e9;

/** The most likely tags for `chars` (Viterbi); the last one is always E or S. */
export function tagCharacters(chars: readonly string[], model: HmmModel): HmmState[] {
  if (!chars.length) return [];
  let scores = new Map<HmmState, number>();
  const paths = new Map<HmmState, HmmState[]>();
  for (const s of STATES) {
    scores.set(s, model.start[s] + (model.emit[s][chars[0]] ?? IMPOSSIBLE));
    paths.set(s, [s]);
  }
  for (let t = 1; t < chars.length; t++) {
    const next = new Map<HmmState, number>();
    const nextPaths = new Map<HmmState, HmmState[]>();
    for (const s of STATES) {
      const emit = model.emit[s][chars[t]] ?? IMPOSSIBLE;
      let best = -Infinity;
      let from: HmmState = PREVIOUS[s][0];
      for (const p of PREVIOUS[s]) {
        const score = scores.get(p)! + (model.trans[p][s] ?? IMPOSSIBLE) + emit;
        if (score > best) {
          best = score;
          from = p;
        }
      }
      next.set(s, best);
      nextPaths.set(s, [...paths.get(from)!, s]);
    }
    scores = next;
    for (const [s, path] of nextPaths) paths.set(s, path);
  }
  return paths.get(scores.get('E')! >= scores.get('S')! ? 'E' : 'S')!;
}

/**
 * Joins characters left over as single-character words into words the dictionary doesn't have
 * (names, new words), as jieba does: a run of two or more single characters that isn't itself a
 * word is re-split by a character-tagging model. Wraps any segmenter.
 *
 * Characters in `keepApart` are never joined (the run is split around them). Without that the
 * model joins far more wrongly than rightly: number + measure word (一年, 万元), 这是… Measured
 * with scripts/measure-chinese-segmentation.mjs.
 */
export class UnknownWordJoiner implements WordSegmenter {
  // Keyed by the inner segmenter's result: a cached result gives a cached join, and new data
  // (a new result array) gives a new one.
  private readonly joined = new WeakMap<WordSpan[], WordSpan[]>();

  constructor(
    private readonly inner: WordSegmenter,
    private readonly model: HmmModel,
    /** Whether a run of characters is a word as it is (then it's left as single characters). */
    private readonly isWord: (word: string) => boolean,
    private readonly keepApart: ReadonlySet<string> = new Set(),
    private readonly script = /^\p{Script=Han}$/u,
  ) {}

  segment(text: string): WordSpan[] {
    const spans = this.inner.segment(text);
    const cached = this.joined.get(spans);
    if (cached) return cached;

    const single = (s: WordSpan) => s.isWord && this.script.test(text.slice(s.start, s.end));
    const out: WordSpan[] = [];
    for (let i = 0; i < spans.length; ) {
      let j = i;
      const joinable = (s: WordSpan) => single(s) && !this.keepApart.has(text.slice(s.start, s.end));
      while (j < spans.length && joinable(spans[j]) && (j === i || spans[j].start === spans[j - 1].end)) j++;
      if (j - i >= 2 && !this.isWord(text.slice(spans[i].start, spans[j - 1].end))) {
        this.split(text, spans.slice(i, j), out);
        i = j;
      } else if (j > i) {
        for (; i < j; i++) out.push(spans[i]);
      } else out.push(spans[i++]);
    }
    this.joined.set(spans, out);
    return out;
  }

  private split(text: string, singles: WordSpan[], out: WordSpan[]): void {
    const tags = tagCharacters(singles.map((s) => text.slice(s.start, s.end)), this.model);
    let start = singles[0].start;
    tags.forEach((tag, k) => {
      if (tag === 'B') start = singles[k].start;
      else if (tag === 'E' || tag === 'S') {
        out.push({ start: tag === 'S' ? singles[k].start : start, end: singles[k].end, isWord: true });
      }
    });
  }
}
