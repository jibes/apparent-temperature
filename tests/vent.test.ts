import { describe, expect, it } from 'vitest';
import { ventDuration, ventEffects, ventReason, ventVerdict } from '../src/core/vent';

describe('ventVerdict', () => {
  it('recommends airing with cool dry air', () => {
    expect(ventVerdict(24, 60, 10, 60).key).toBe('recommended');
  });
  it('warns of condensation when outdoor dew point exceeds indoor temp', () => {
    expect(ventVerdict(15, 50, 25, 90)).toEqual({ key: 'condensation', cls: 'bad' });
  });
  it('sees no effect for identical air', () => {
    expect(ventVerdict(21, 50, 21, 50).key).toBe('noEffect');
  });
  it('advises against humid warm air', () => {
    expect(ventVerdict(22, 40, 28, 55).key).toBe('notRecommended');
  });
});

describe('ventReason', () => {
  it('agrees with the verdict', () => {
    expect(ventReason(24, 60, 10, 60).kind).toBe('drierCooler');
    expect(ventReason(21, 50, 21, 50).kind).toBe('same');
    expect(ventReason(15, 50, 25, 90).kind).toBe('condensation');
  });
});

describe('ventEffects', () => {
  it('reports at most moisture and heat', () => {
    const e = ventEffects(24, 60, 10, 60);
    expect(e.map((x) => x.kind)).toEqual(['moisture', 'heat']);
    expect(e.every((x) => !('up' in x) || x.up === false)).toBe(true);
  });
  it('condensation dominates', () => {
    expect(ventEffects(15, 50, 25, 90)).toEqual([{ kind: 'condensation' }]);
  });
  it('fresh air only when nothing changes', () => {
    expect(ventEffects(21, 50, 21, 50)).toEqual([{ kind: 'freshAir' }]);
  });
});

describe('ventDuration', () => {
  it('shrinks with gradient and wind', () => {
    expect(ventDuration(10, 0)).toBe('short');
    expect(ventDuration(3, 10)).toBe('medium');
    expect(ventDuration(1, 0)).toBe('long');
  });
});
