import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, startHand } from '../engine/holdem';
import { amountToSlider, betPresets, sliderToAmount } from './betSizing';

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `J${i}`, stack: 400 }));
const cfg = { structure: 'NL' as const, smallBlind: 1, bigBlind: 2, buttonIndex: 0, seed: 7 };

describe('montants rapides', () => {
  it('ouverture préflop en BB, puis 3-bet et 4-bet', () => {
    let s = startHand(seats(4), cfg);
    expect(betPresets(s, legalActions(s)!).map((b) => b.label)).toEqual(['2,5 BB', '3 BB', '4 BB', 'Pot', 'Tapis']);
    s = applyAction(s, { type: 'raise', to: 6 });
    const three = betPresets(s, legalActions(s)!);
    expect(three[0]).toEqual({ label: '3-bet ×3', to: 18 });
    s = applyAction(s, { type: 'raise', to: 18 });
    expect(betPresets(s, legalActions(s)!)[0]).toEqual({ label: '4-bet ×2,2', to: 40 });
  });
  it('fractions du pot après le flop', () => {
    let s = startHand(seats(2), cfg);
    s = applyAction(s, { type: 'raise', to: 6 });
    s = applyAction(s, { type: 'call' });
    expect(s.street).toBe('flop');
    const p = betPresets(s, legalActions(s)!);
    expect(p.find((b) => b.label === '½ pot')!.to).toBe(6);
    expect(p.find((b) => b.label === 'Pot')!.to).toBe(12);
  });
  it('le curseur est progressif et réversible', () => {
    const s = startHand(seats(3), cfg);
    const l = legalActions(s)!;
    expect(sliderToAmount(0, l)).toBe(l.minTo);
    expect(sliderToAmount(1, l)).toBe(l.maxTo);
    expect(sliderToAmount(0.3, l)).toBeLessThan(l.minTo + (l.maxTo - l.minTo) * 0.1);
    expect(sliderToAmount(amountToSlider(50, l), l)).toBe(50);
  });
});
