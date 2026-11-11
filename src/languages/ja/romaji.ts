/**
 * Kana → romaji (Hepburn), for readings in the popup: たべる → taberu, がっこう → gakkou,
 * きょう → kyou, コーヒー → koohii, しんいち → shin'ichi. Long vowels are spelled out (no macrons),
 * as the kana write them.
 */

const BASE: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n', ゔ: 'vu',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o', ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa',
};

/** Two-kana sounds: きゃ kya, しょ sho, ちゅ chu, ファ fa, ティ ti… */
const PAIRS: Record<string, string> = {};
for (const [kana, romaji] of Object.entries({ き: 'k', ぎ: 'g', に: 'n', ひ: 'h', び: 'b', ぴ: 'p', み: 'm', り: 'r' })) {
  PAIRS[kana + 'ゃ'] = romaji + 'ya';
  PAIRS[kana + 'ゅ'] = romaji + 'yu';
  PAIRS[kana + 'ょ'] = romaji + 'yo';
}
for (const [kana, romaji] of Object.entries({ し: 'sh', じ: 'j', ち: 'ch', ぢ: 'j' })) {
  PAIRS[kana + 'ゃ'] = romaji + 'a';
  PAIRS[kana + 'ゅ'] = romaji + 'u';
  PAIRS[kana + 'ょ'] = romaji + 'o';
}
Object.assign(PAIRS, {
  ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo', ふゅ: 'fyu',
  てぃ: 'ti', でぃ: 'di', とぅ: 'tu', どぅ: 'du', てゅ: 'tyu', でゅ: 'dyu',
  しぇ: 'she', じぇ: 'je', ちぇ: 'che', つぁ: 'tsa', つぃ: 'tsi', つぇ: 'tse', つぉ: 'tso',
  うぃ: 'wi', うぇ: 'we', うぉ: 'wo', ゔぁ: 'va', ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo',
});

/** Katakana → hiragana (same sounds, 0x60 apart). */
const toHiragana = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

export function toRomaji(kana: string): string {
  const text = toHiragana(kana);
  let out = '';
  let double = false; // after っ: double the next consonant
  for (let i = 0; i < text.length; ) {
    const pair = PAIRS[text.slice(i, i + 2)];
    const char = text[i];
    let piece: string;
    if (pair) {
      piece = pair;
      i += 2;
    } else if (char === 'っ') {
      double = true;
      i++;
      continue;
    } else if (char === 'ー') {
      // A long vowel: the previous vowel again (コーヒー → koohii).
      piece = /[aeiou]$/.exec(out)?.[0] ?? '';
      i++;
    } else {
      piece = BASE[char] ?? char;
      i++;
    }
    if (double) {
      double = false;
      // っち → tchi (Hepburn); otherwise the consonant twice (がっこう → gakkou).
      if (piece.startsWith('ch')) piece = 't' + piece;
      else if (/^[bcdfghjkmpqrstvwxyz]/.test(piece)) piece = piece[0] + piece;
    }
    // ん before a vowel or y: n' (しんいち → shin'ichi, not shi-ni-chi).
    if (out.endsWith('n') && /^[aeiouy]/.test(piece) && text[i - (pair ? 2 : 1) - 1] === 'ん') out += "'";
    out += piece;
  }
  return out;
}
