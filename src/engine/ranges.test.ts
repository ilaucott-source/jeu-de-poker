import { describe, expect, it } from 'vitest';
import type { Card } from './cards';
import { equityVsRanges, gridName, topPercent, foldEquityNeeded, preflopChart, positionOf } from './ranges';
import { applyAction, startHand } from './holdem';

const h = (s: string) => s.split(' ') as Card[];

describe('ranges', () => {
  it('compte les combinaisons', () => {
    expect(topPercent('AA')).toBeCloseTo(6 / 1326, 5);
    expect(topPercent(['72o', '32o'].find((n) => topPercent(n) === 1) ?? '')).toBe(1);
  });
  it('construit la grille 13×13', () => {
    expect(gridName(0, 0)).toBe('AA');
    expect(gridName(0, 1)).toBe('AKs');
    expect(gridName(1, 0)).toBe('AKo');
    expect(gridName(12, 12)).toBe('22');
  });
  it('AK perd de la valeur contre une range de 4-bet', () => {
    const vsAny = equityVsRanges(h('Ah Kd'), [], [1], 3000);
    const vsTight = equityVsRanges(h('Ah Kd'), [], [0.03], 3000);
    expect(vsAny).toBeGreaterThan(0.6);
    expect(vsTight).toBeLessThan(0.5);
  });
  it('fold equity nécessaire', () => {
    expect(foldEquityNeeded(10, 10)).toBe(0.5);
  });
  it('positions et conseil de 3-bet', () => {
    const seats = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, stack: 200 }));
    let s = startHand(seats, { structure: 'NL', smallBlind: 1, bigBlind: 2, buttonIndex: 0, seed: 3 });
    expect(positionOf(s, 0)).toBe('BTN');
    expect(positionOf(s, s.sbIndex)).toBe('SB');
    expect(positionOf(s, s.bbIndex)).toBe('BB');
    expect(positionOf(s, 3)).toBe('UTG');
    expect(positionOf(s, 5)).toBe('CO');
    // UTG ouvre, tout le monde se couche jusqu'au bouton
    s = applyAction(s, { type: 'raise', to: 6 });
    s = applyAction(s, { type: 'fold' });
    s = applyAction(s, { type: 'fold' });
    const c = preflopChart(s, 0)!;
    expect(c.advise('AA')).toBe('raise');
    expect(c.advise('72o')).toBe('fold');
    expect(['call', 'raise']).toContain(c.advise('AQs'));
  });
});
