/**
 * Japanese conjugation, undone: 食べました → 食べる, 書かなかった → 書く, 来られる → 来る.
 *
 * Rules swap an ending for another (なかった → ない) and say what the result is: a dictionary form
 * (an ichidan or godan verb, する, 来る, an い-adjective) or an in-between form that other rules
 * continue from (ます, て, た). Applying them repeatedly from the word as written gives every way
 * it could be an inflection; the dictionary then says which of those bases are real words with the
 * right part of speech (`matchesPos`). No imports.
 */

/** Word types (bit flags). The first five are dictionary forms. */
export const V1 = 1; // ichidan: 食べる
export const V5 = 2; // godan: 書く
export const VK = 4; // 来る
export const VS = 8; // する
export const ADJ = 16; // い-adjective (and ない, たい, which conjugate like one)
const MASU = 32; // 食べます
const TE = 64; // 食べて
const TA = 128; // 食べた
const COP = 256; // です / だ
const IKU = 512; // 行く's own te-form and past (行って, not 行いて)
const DICTIONARY = V1 | V5 | VK | VS | ADJ | COP | IKU;
/** As written: any rule may apply. */
const ANY = 0xffff;

interface Rule {
  from: string;
  to: string;
  /** What the word must be for the rule to apply. */
  in: number;
  /** What the result is. */
  out: number;
  reason: string;
}

const rules: Rule[] = [];
const rule = (from: string, to: string, inTypes: number, out: number, reason: string) => rules.push({ from, to, in: inTypes, out, reason });

// Godan verbs, by the row of their last kana.
const U = ['う', 'く', 'ぐ', 'す', 'つ', 'ぬ', 'ぶ', 'む', 'る'];
const A = ['わ', 'か', 'が', 'さ', 'た', 'な', 'ば', 'ま', 'ら'];
const I = ['い', 'き', 'ぎ', 'し', 'ち', 'に', 'び', 'み', 'り'];
const E = ['え', 'け', 'げ', 'せ', 'て', 'ね', 'べ', 'め', 'れ'];
const O = ['お', 'こ', 'ご', 'そ', 'と', 'の', 'ぼ', 'も', 'ろ'];
const TE_FORM = ['って', 'いて', 'いで', 'して', 'って', 'んで', 'んで', 'んで', 'って'];
const past = (te: string) => te.slice(0, -1) + (te.endsWith('で') ? 'だ' : 'た');

/** Endings shared by every verb, after its stem: [ending, in, out, reason]. */
const stemEndings = (stem: (kind: 'a' | 'i' | 'e' | 'o') => string, base: string, type: number) => {
  rule(stem('a') + 'ない', base, ADJ, type, 'negative');
  rule(stem('a') + 'ず', base, ANY, type, 'negative (ず)');
  rule(stem('a') + 'ずに', base, ANY, type, 'without doing');
  rule(stem('i') + 'ます', base, MASU, type, 'polite');
  rule(stem('i') + 'たい', base, ADJ, type, 'want to');
  rule(stem('i') + 'なさい', base, ANY, type, 'polite command');
  rule(stem('i') + 'そう', base, ANY, type, 'looks like');
  rule(stem('i') + 'ながら', base, ANY, type, 'while');
  rule(stem('i') + 'すぎる', base, V1, type, 'too much');
  rule(stem('i') + 'やすい', base, ADJ, type, 'easy to');
  rule(stem('i') + 'にくい', base, ADJ, type, 'hard to');
  rule(stem('i') + 'たがる', base, V5, type, 'wants to');
  // The bare stem, before に (見に行く), in compounds and as a noun (書き, 食べ).
  if (stem('i')) rule(stem('i'), base, ANY, type, 'stem');
};

// 行く: 行って, 行った (only for its own class, v5k-s). First: いった is more often 行く than 行う.
rule('って', 'く', TE, IKU, 'te-form');
rule('った', 'く', TA, IKU, 'past');
U.forEach((u, k) => {
  const stem = (kind: 'a' | 'i' | 'e' | 'o') => ({ a: A, i: I, e: E, o: O })[kind][k];
  stemEndings(stem, u, V5);
  rule(A[k] + 'ぬ', u, ANY, V5, 'negative (ぬ)');
  rule(A[k] + 'ん', u, ANY, V5, 'negative (ん)');
  rule(A[k] + 'れる', u, V1, V5, 'passive');
  rule(A[k] + 'せる', u, V1, V5, 'causative');
  rule(A[k] + 'される', u, V1, V5, 'causative passive');
  rule(E[k] + 'る', u, V1, V5, 'potential');
  rule(E[k] + 'ば', u, ANY, V5, 'if');
  rule(E[k], u, ANY, V5, 'imperative');
  rule(O[k] + 'う', u, ANY, V5, 'volitional');
  rule(TE_FORM[k], u, TE, V5, 'te-form');
  rule(past(TE_FORM[k]), u, TA, V5, 'past');
});

// Ichidan verbs: the stem is everything before る.
stemEndings(() => '', 'る', V1);
for (const [from, inTypes, out, reason] of [
  ['た', TA, V1, 'past'],
  ['て', TE, V1, 'te-form'],
  ['よう', ANY, V1, 'volitional'],
  ['られる', V1, V1, 'passive or potential'],
  ['れる', V1, V1, 'potential'],
  ['させる', V1, V1, 'causative'],
  ['ろ', ANY, V1, 'imperative'],
  ['よ', ANY, V1, 'imperative'],
  ['れば', ANY, V1, 'if'],
  ['ん', ANY, V1, 'negative (ん)'],
] as const) rule(from, 'る', inTypes, out, reason);

// 来る, in kana and with its kanji (whose reading changes: 来ない is こない).
for (const [head, base] of [['', 'くる'], ['来', '来る']]) {
  const kana = (k: string) => (head ? head : k);
  stemEndings((kind) => kana({ a: 'こ', i: 'き', e: 'く', o: 'こ' }[kind]), base, VK);
  rule(kana('き') + 'た', base, TA, VK, 'past');
  rule(kana('き') + 'て', base, TE, VK, 'te-form');
  rule(kana('こ') + 'よう', base, ANY, VK, 'volitional');
  rule(kana('こ') + 'られる', base, V1, VK, 'passive or potential');
  rule(kana('こ') + 'れる', base, V1, VK, 'potential');
  rule(kana('こ') + 'させる', base, V1, VK, 'causative');
  rule(kana('こ') + 'い', base, ANY, VK, 'imperative');
  rule(kana('く') + 'れば', base, ANY, VK, 'if');
}

// する.
stemEndings((kind) => ({ a: 'し', i: 'し', e: 'す', o: 'し' })[kind], 'する', VS);
rule('せず', 'する', ANY, VS, 'negative (ず)');
rule('せずに', 'する', ANY, VS, 'without doing');
rule('した', 'する', TA, VS, 'past');
rule('して', 'する', TE, VS, 'te-form');
rule('しよう', 'する', ANY, VS, 'volitional');
rule('される', 'する', V1, VS, 'passive');
rule('させる', 'する', V1, VS, 'causative');
rule('しろ', 'する', ANY, VS, 'imperative');
rule('せよ', 'する', ANY, VS, 'imperative');
rule('すれば', 'する', ANY, VS, 'if');

// い-adjectives (and ない, たい).
for (const [from, inTypes, reason] of [
  ['く', ANY, 'adverb'],
  ['かった', ANY, 'past'],
  ['かったら', ANY, 'if (past)'],
  ['かったり', ANY, 'doing things like'],
  ['くない', ADJ, 'negative'],
  ['くて', ANY, 'te-form'],
  ['ければ', ANY, 'if'],
  ['かろう', ANY, 'volitional'],
  ['そう', ANY, 'looks like'],
  ['すぎる', V1, 'too much'],
  ['くなる', V5, 'becomes'],
  ['さ', ANY, 'noun (-ness)'],
] as const) rule(from, 'い', inTypes, ADJ, reason);

// ます.
for (const [from, reason] of [
  ['ました', 'past'],
  ['ません', 'negative'],
  ['ませんでした', 'past negative'],
  ['ましょう', 'volitional'],
  ['まして', 'te-form'],
  ['ませ', 'imperative'],
] as const) rule(from, 'ます', ANY, MASU, reason);

// Forms built on the te-form and the past.
for (const [from, to, inTypes, reason] of [
  ['ている', 'て', V1, 'progressive'],
  ['でいる', 'で', V1, 'progressive'],
  ['てる', 'て', V1, 'progressive'],
  ['でる', 'で', V1, 'progressive'],
  ['てしまう', 'て', V5, 'completely'],
  ['でしまう', 'で', V5, 'completely'],
  ['ちゃう', 'て', V5, 'completely'],
  ['じゃう', 'で', V5, 'completely'],
  ['ておく', 'て', V5, 'in advance'],
  ['でおく', 'で', V5, 'in advance'],
  ['とく', 'て', V5, 'in advance'],
  ['どく', 'で', V5, 'in advance'],
  ['てある', 'て', V5, 'has been done'],
  ['である', 'で', V5, 'has been done'],
  ['ていく', 'て', V5, 'going on'],
  ['でいく', 'で', V5, 'going on'],
  ['てくる', 'て', VK, 'coming'],
  ['でくる', 'で', VK, 'coming'],
  ['てください', 'て', ANY, 'please'],
  ['でください', 'で', ANY, 'please'],
] as const) rule(from, to, inTypes, TE, reason);
for (const [from, to, reason] of [
  ['たら', 'た', 'if'],
  ['だら', 'だ', 'if'],
  ['たり', 'た', 'doing things like'],
  ['だり', 'だ', 'doing things like'],
] as const) rule(from, to, ANY, TA, reason);

// The copula: でした → です, だった → だ.
for (const [from, to, reason] of [
  ['でした', 'です', 'past'],
  ['でしょう', 'です', 'probably'],
  ['だった', 'だ', 'past'],
  ['だろう', 'だ', 'probably'],
] as const) rule(from, to, ANY, COP, reason);

/** Rules by the last character of their ending, for speed. */
const byLast = new Map<string, Rule[]>();
for (const r of rules) {
  const last = r.from.at(-1)!;
  let list = byLast.get(last);
  if (!list) byLast.set(last, (list = []));
  list.push(r);
}

export interface Deinflection {
  /** The dictionary form to look up. */
  base: string;
  /** What it must be (word type flags). */
  type: number;
  /** How the written form was made from it, outermost last (e.g. ["polite", "past"]). */
  reasons: string[];
}

const MAX_DEPTH = 6;
const HAN = /\p{Script=Han}/u;

/** Every base `word` could be an inflection of, nearest first (the word itself isn't included). */
export function deinflect(word: string): Deinflection[] {
  const out: Deinflection[] = [];
  const seen = new Set<string>();
  let frontier: { word: string; type: number; reasons: string[] }[] = [{ word, type: ANY, reasons: [] }];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    const next: typeof frontier = [];
    for (const form of frontier) {
      for (const r of byLast.get(form.word.at(-1) ?? '') ?? []) {
        if (!(r.in & form.type) || !form.word.endsWith(r.from)) continue;
        const stem = form.word.slice(0, form.word.length - r.from.length);
        // Ichidan endings need a stem; a bare る, た or て isn't a verb.
        if (!stem && r.to.length <= 1 && (r.out & (V1 | V5))) continue;
        // A bare stem of a godan verb needs more than its kana (書き, not き).
        if (r.reason === 'stem' && !stem) continue;
        const base = stem + r.to;
        const key = `${base}:${r.out}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const result = { word: base, type: r.out, reasons: [r.reason, ...form.reasons] };
        if (r.out & DICTIONARY) out.push({ base, type: r.out, reasons: result.reasons });
        next.push(result);
      }
    }
    frontier = next;
  }
  // An ichidan verb's bare stem has no ending to undo (見 of 見に行く, 食べ): only for words with
  // kanji, or every kana would be a stem (い of いる).
  if (HAN.test(word) && !word.endsWith('る')) out.push({ base: word + 'る', type: V1, reasons: ['stem'] });
  return out;
}

const GODAN_POS: Record<string, string[]> = {
  う: ['v5u', 'v5u-s'],
  く: ['v5k', 'v5k-s'],
  ぐ: ['v5g'],
  す: ['v5s'],
  つ: ['v5t'],
  ぬ: ['v5n'],
  ぶ: ['v5b'],
  む: ['v5m'],
  る: ['v5r', 'v5r-i', 'v5aru'],
};

/** True when a dictionary entry with these parts of speech can be `type` with this base. */
export function matchesPos(type: number, base: string, pos: readonly string[]): boolean {
  if (type & V1 && pos.some((p) => p === 'v1' || p === 'v1-s')) return true;
  if (type & V5 && pos.some((p) => (GODAN_POS[base.at(-1) ?? ''] ?? []).includes(p))) return true;
  if (type & IKU && pos.includes('v5k-s')) return true;
  if (type & VK && pos.includes('vk')) return true;
  if (type & VS && pos.some((p) => p === 'vs-i' || p === 'vs-s')) return true;
  if (type & ADJ && pos.some((p) => p === 'adj-i' || p === 'adj-ix')) return true;
  if (type & COP && pos.includes('cop')) return true;
  return false;
}
