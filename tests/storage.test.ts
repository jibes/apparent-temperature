import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasPref, prefKey, readPref, writePref } from '../src/storage';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
});

describe('prefs', () => {
  it('uses versioned keys', () => {
    expect(prefKey('inTemp')).toBe('apparent-temperature.inTemp.v1');
    writePref('inTemp', 21.5);
    expect(localStorage.getItem('apparent-temperature.inTemp.v1')).toBe('21.5');
    expect(readPref('inTemp', 0)).toBe(21.5);
  });
  it('migrates a legacy key once and removes it', () => {
    localStorage.setItem('inTemp', '23');
    expect(hasPref('inTemp')).toBe(true);
    expect(readPref('inTemp', 0)).toBe(23);
    expect(localStorage.getItem('inTemp')).toBeNull();
    expect(localStorage.getItem(prefKey('inTemp'))).toBe('23');
  });
  it('falls back on missing or corrupt values', () => {
    expect(hasPref('inRH')).toBe(false);
    expect(readPref('inRH', 55)).toBe(55);
    localStorage.setItem(prefKey('inRH'), '{oops');
    expect(readPref('inRH', 55)).toBe(55);
  });
});
