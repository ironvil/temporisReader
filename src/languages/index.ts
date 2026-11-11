import { GermanLanguage } from './de';
import { FrenchLanguage } from './fr';
import { JapaneseLanguage } from './ja';
import type { LanguageModule } from './types';
import { ChineseLanguage } from './zh';

export const chinese = new ChineseLanguage();
export const french = new FrenchLanguage();
export const german = new GermanLanguage();
export const japanese = new JapaneseLanguage();

/** All supported languages. Add new LanguageModule implementations here. */
export const languages: LanguageModule[] = [chinese as LanguageModule, french as LanguageModule, german as LanguageModule, japanese as LanguageModule];

export function getLanguage(id: string | null | undefined): LanguageModule | null {
  return languages.find((l) => l.id === id) ?? null;
}

/** Best matching language for a text sample, or null if nothing is confident. */
export function detectLanguage(sample: string): string | null {
  let best: { id: string; score: number } | null = null;
  for (const lang of languages) {
    const score = lang.detect(sample);
    if (score > 0.2 && (!best || score > best.score)) best = { id: lang.id, score };
  }
  return best?.id ?? null;
}
