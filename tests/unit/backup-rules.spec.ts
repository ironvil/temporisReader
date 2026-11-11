/**
 * Android's backup rules (android/app/src/main/res/xml) list paths by hand. These checks keep the
 * two files in step, and keep half-downloaded dictionaries out of phone-to-phone transfers.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { languages } from '../../src/languages';

const xml = (name: string) => readFileSync(new URL(`../../android/app/src/main/res/xml/${name}`, import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const rules = (text: string, kind: 'include' | 'exclude') => [...text.matchAll(new RegExp(`<${kind} domain="(\\w+)" path="([^"]+)"`, 'g'))].map((m) => `${m[1]}:${m[2]}`);
const section = (text: string, name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1] ?? '';

const BACKED_UP = ['file:library.json', 'file:settings.json', 'file:known-words/', 'file:books/'];

test('cloud backups hold only what can’t be rebuilt, on every Android version', () => {
  const old = xml('backup_rules.xml');
  const cloud = section(xml('data_extraction_rules.xml'), 'cloud-backup');
  expect(rules(old, 'include')).toEqual(BACKED_UP);
  expect(rules(cloud, 'include')).toEqual(BACKED_UP);
  expect(rules(old, 'exclude')).toEqual([]);
  expect(rules(cloud, 'exclude')).toEqual([]);
});

test('phone-to-phone transfers also carry dictionaries, but not unfinished downloads', () => {
  const transfer = section(xml('data_extraction_rules.xml'), 'device-transfer');
  expect(rules(transfer, 'include')).toEqual([...BACKED_UP, 'file:dictionaries/']);
  const downloads = languages.flatMap((lang) => lang.dictionaries.map((d) => `file:dictionaries/${d.id}.download.gz`));
  expect(rules(transfer, 'exclude').sort()).toEqual(downloads.sort());
});
