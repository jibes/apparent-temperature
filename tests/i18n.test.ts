import { describe, expect, it } from 'vitest';
import { catalogues, detectLang } from '../src/i18n';

// Deep key shape: same keys, same function-ness, same array lengths.
function shape(v: unknown): unknown {
  if (typeof v === 'function') return `fn${v.length}`;
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]));
  return typeof v;
}

describe('i18n', () => {
  it('German has exactly the English keys', () => {
    expect(shape(catalogues.de)).toEqual(shape(catalogues.en));
  });
  it('detects German, defaults to English', () => {
    expect(detectLang({ language: 'de-AT' })).toBe('de');
    expect(detectLang({ language: 'fr-FR' })).toBe('en');
    expect(detectLang(undefined)).toBe('en');
  });
  it('German spells Außen with ß', () => {
    expect(catalogues.de.vent.outdoor).toBe('Außen');
    expect(JSON.stringify(catalogues.de)).not.toMatch(/Aussen/);
  });
});
