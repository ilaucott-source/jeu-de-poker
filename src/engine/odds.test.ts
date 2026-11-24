import { describe, expect, it } from 'vitest';
import type { Card } from './cards';
import { equity, hitChances, outs, potOddsNeeded, startingHandName, startingHandPercentile } from './odds';

const h = (s: string) => s.split(' ') as Card[];

describe('statistiques', () => {
  it('nomme les mains de départ', () => {
    expect(startingHandName(h('Kh As'))).toBe('AKo');
    expect(startingHandName(h('Js Qs'))).toBe('QJs');
    expect(startingHandName(h('7d 7c'))).toBe('77');
  });
  it('AA contre une main au hasard gagne environ 85 %', () => {
    const e = equity(h('As Ah'), [], 1, 4000).equity;
    expect(e).toBeGreaterThan(0.82);
    expect(e).toBeLessThan(0.88);
  });
  it("l'équité baisse avec le nombre d'adversaires", () => {
    expect(equity(h('As Ah'), [], 5, 1500).equity).toBeLessThan(0.6);
  });
  it('compte 9 outs pour un tirage couleur', () => {
    const o = outs(h('Ah Kh'), h('2h 7h 9c'));
    expect(o.filter((x) => x.makes === 'Couleur').length).toBe(9);
  });
  it('tirage quinte par les deux bouts : 8 outs', () => {
    const o = outs(h('8c 9d'), h('6h 7s 2c'));
    expect(o.filter((x) => x.makes === 'Quinte').length).toBe(8);
  });
  it('probabilités de toucher', () => {
    const c = hitChances(9, 3);
    expect(c.next).toBeCloseTo(9 / 47, 5);
    expect(c.byRiver).toBeCloseTo(0.35, 2);
  });
  it('cote du pot', () => {
    expect(potOddsNeeded(50, 100)).toBeCloseTo(1 / 3, 5);
  });
  it('AA est la meilleure main de départ, 72o parmi les pires', () => {
    expect(startingHandPercentile(h('As Ad'))).toBe(0);
    expect(startingHandPercentile(h('7c 2d'))).toBeGreaterThan(0.9);
  });
});
