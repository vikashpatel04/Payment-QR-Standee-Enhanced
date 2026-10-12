import { DISPLAY_LANGUAGES } from '@counterpay/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Tree = { [key: string]: string | Tree };

const dir = join(__dirname, '..', '..', '..', 'locales');
const load = (lang: string): Tree => JSON.parse(readFileSync(join(dir, `${lang}.json`), 'utf8')) as Tree;

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

describe('locale files', () => {
  const en = flatten(load('en'));
  const enDisplay = Object.keys(en).filter((k) => k.startsWith('display.') || k === 'language.name');

  it.each(DISPLAY_LANGUAGES.filter((l) => l !== 'en'))('%s has every display string, with the same placeholders', (lang) => {
    const strings = flatten(load(lang));
    for (const key of enDisplay) {
      expect(strings[key], `${lang}: ${key}`).toBeTruthy();
      expect(placeholders(strings[key]!), `${lang}: ${key}`).toEqual(placeholders(en[key]!));
    }
  });

  it('names every display language for the language pickers', () => {
    for (const display of DISPLAY_LANGUAGES) expect(en[`app.language.${display}`], display).toBeTruthy();
  });
});
