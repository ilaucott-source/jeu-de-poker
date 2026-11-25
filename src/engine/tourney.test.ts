import { describe, expect, it } from 'vitest';
import { applyAction, startHand, type SeatInput } from './holdem';
import { callPrice, icmValues, pushRange, stageOf } from './tourney';
import { handClass } from './ranges';
import { eqVsRandom, eqVsTop } from './preflopTable';
import { flopOdds } from './flopOdds';
import type { Card } from './cards';

describe('ICM et stade du tournoi', () => {
  it('ICM : tapis égaux = gains égaux, et un tapis double vaut moins du double', () => {
    const eq = icmValues([1000, 1000, 1000, 1000], [0.5, 0.3, 0.2]);
    eq.forEach((v) => expect(v).toBeCloseTo(0.25, 5));
    const v = icmValues([2000, 1000, 1000], [0.5, 0.3, 0.2]);
    expect(v.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    expect(v[0]).toBeLessThan(2 * v[1]);
  });

  it('détecte la bulle et exige plus d’équité pour payer un tapis', () => {
    const seats: SeatInput[] = [
      { id: 'a', name: 'A', stack: 3000 },
      { id: 'b', name: 'B', stack: 3000 },
      { id: 'c', name: 'C', stack: 3000 },
      { id: 'd', name: 'D', stack: 3000 },
      { id: 'x', name: 'X', stack: 0 },
      { id: 'y', name: 'Y', stack: 0 },
    ];
    let h = startHand(seats, { structure: 'NL', smallBlind: 100, bigBlind: 200, buttonIndex: 0, seed: 3, tourney: { payouts: [0.5, 0.3, 0.2] } });
    const info = stageOf(h)!;
    expect(info.stage).toBe('bubble');
    // le premier à parler pousse, le suivant doit décider
    const shover = h.toAct!;
    h = applyAction(h, { type: 'raise', to: 3000 });
    const price = callPrice(h, h.toAct!, shover);
    expect(price.chip).toBeLessThan(0.5);
    expect(price.icm).toBeGreaterThan(price.chip + 0.08);
  });

  it('ranges de tapis plus larges quand le tapis est court et en fin de parole', () => {
    expect(pushRange('SB', 5, false)).toBeGreaterThan(pushRange('SB', 10, false));
    expect(pushRange('BTN', 10, false)).toBeGreaterThan(pushRange('UTG', 10, false));
    expect(pushRange('SB', 10, false)).toBeGreaterThan(0.5);
  });
});

describe('lecture des mains et tables préflop', () => {
  it('classe les mains sur un tableau', () => {
    const b = ['Kh', '7d', '2c'] as Card[];
    expect(handClass(['Ks', 'Qd'] as Card[], b)).toBe(3);
    expect(handClass(['7s', '7c'] as Card[], b)).toBe(4);
    expect(handClass(['As', '3d'] as Card[], b)).toBe(0);
    expect(handClass(['Ah', '5h'] as Card[], ['Kh', '7h', '2c'] as Card[])).toBe(1);
  });
  it('équités préflop de référence', () => {
    expect(eqVsRandom('AA', 1)).toBeGreaterThan(0.83);
    expect(eqVsRandom('72o', 1)).toBeLessThan(0.36);
    expect(eqVsTop('AA', 0.02)).toBeGreaterThan(0.7);
    expect(eqVsRandom('AA', 5)).toBeLessThan(eqVsRandom('AA', 1));
  });
  it('probabilités exactes au flop', () => {
    const p = flopOdds(['7s', '7h'] as Card[]);
    expect(p.tripsPlus).toBeGreaterThan(0.11);
    expect(p.tripsPlus).toBeLessThan(0.13);
    const s = flopOdds(['As', 'Ks'] as Card[]);
    expect(s.flushPlus).toBeCloseTo(0.0084, 3);
    expect(s.flushDraw).toBeGreaterThan(0.1);
    expect(s.flushDraw).toBeLessThan(0.12);
    expect(s.pairPlus).toBeGreaterThan(0.3);
  });
});

describe('analyse face à un tapis', () => {
  it('ne conseille pas de relancer quand on paie un tapis avec QQ', async () => {
    const { analyzeHand } = await import('./analysis');
    const seats = [
      { id: 'hero', name: 'Toi', stack: 1000 },
      { id: 'v', name: 'V', stack: 1000 },
    ];
    // on cherche une graine où le héros reçoit QQ
    for (let seed = 1; seed < 20000; seed++) {
      const h = startHand(seats, { structure: 'NL', smallBlind: 10, bigBlind: 20, buttonIndex: 1, seed });
      const hero = h.players.find((p) => p.id === 'hero')!;
      if (hero.holeCards.map((c) => c[0]).join('') !== 'QQ') continue;
      // le bouton (V, petite blind) pousse, le héros paie
      const script = { seats, config: h.config, actions: [{ type: 'raise' as const, to: 1000 }, { type: 'call' as const }] };
      const d = analyzeHand(script, 'hero', 200);
      expect(d[0].grade).toBe('good');
      expect(d[0].title).not.toMatch(/relance/i);
      return;
    }
    throw new Error('pas de QQ trouvée');
  });
});
