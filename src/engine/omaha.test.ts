import { describe, expect, it } from 'vitest';
import { createRng, type Card } from './cards';
import { evaluateOmaha, HandCategory } from './evaluator';
import { applyAction, startHand, stacksAfter, type BettingStructure, type SeatInput } from './holdem';
import { BOT_STYLES, styledBot } from './bots';
import { omahaClass, omahaEquityVsRanges, omahaName, omahaOuts, omahaTop } from './omaha';
import { analyzeHand, scriptActions } from './analysis';

const h = (s: string) => s.split(' ') as Card[];

describe('Omaha', () => {
  it('utilise exactement deux cartes de la main', () => {
    // quatre piques en main + un seul pique au tableau : pas de couleur
    expect(evaluateOmaha(h('As Ks Qs Js'), h('2s 7d 9c Th 3h')).category).not.toBe(HandCategory.Flush);
    // quatre cartes du tableau en quinte, une seule carte en main qui complète : pas de quinte
    expect(evaluateOmaha(h('9c 2d 2h 3c'), h('5s 6d 7h 8c Kd')).category).toBe(HandCategory.Pair);
    expect(evaluateOmaha(h('9c Td 2h 3c'), h('6s 7d 8h Kc Kd')).category).toBe(HandCategory.Straight);
    expect(evaluateOmaha(h('As 2s Kd Kc'), h('5s 9s Qs 3d 4h')).category).toBe(HandCategory.Flush); // A2 de pique
  });
  it('classe les mains de départ de façon cohérente', () => {
    expect(omahaTop(h('As Ah Ks Kh'))).toBeLessThan(0.01);
    expect(omahaTop(h('Js Th 9s 8h'))).toBeLessThan(0.08);
    expect(omahaTop(h('7c 2d 3h 9s'))).toBeGreaterThan(0.85);
    expect(omahaName(h('Js Th 9s 8h'))).toBe('JT98ds');
  });
  it('estime l’équité, les tirages et les outs', () => {
    expect(omahaEquityVsRanges(h('As Ah Ks Kh'), [], [1], 800)).toBeGreaterThan(0.6);
    expect(omahaClass(h('As Ks 7d 8c'), h('2s 9s Jh'))).toBe(1);
    expect(omahaClass(h('Kd Kc 7d 8c'), h('Ks 9s 2h'))).toBe(4);
    expect(omahaOuts(h('As Ks 7d 8c'), h('2s 9s Jh')).length).toBeGreaterThanOrEqual(9);
  });
  it('les bots jouent des mains complètes sans erreur, jetons conservés', () => {
    for (const structure of ['PL', 'NL', 'FL'] as BettingStructure[]) {
      const rng = createRng(5);
      const styles = BOT_STYLES.slice(0, 6);
      let seats: SeatInput[] = styles.map((s, i) => ({ id: `b${i}`, name: s.name, stack: 200 }));
      for (let n = 0; n < (structure === 'PL' ? 60 : 20); n++) {
        seats = seats.map((x) => (x.stack < 20 ? { ...x, stack: 200 } : x));
        const config = { variant: 'omaha' as const, structure, smallBlind: 1, bigBlind: 2, buttonIndex: n % 6, seed: 300 + n };
        let st = startHand(seats, config);
        expect(st.players.every((p) => p.holeCards.length === 4)).toBe(true);
        let guard = 0;
        while (st.toAct !== null && guard++ < 500) {
          const p = st.players[st.toAct];
          st = applyAction(st, styledBot(st, styles.find((s) => s.name === p.name)!, rng));
        }
        expect(st.street).toBe('complete');
        const before = seats.reduce((a, x) => a + x.stack, 0);
        // l'analyse fonctionne aussi (du point de vue du premier bot)
        if (n % 10 === 0) analyzeHand({ seats, config, actions: scriptActions(st) }, 'b0', 120);
        seats = stacksAfter(st);
        expect(seats.reduce((a, x) => a + x.stack, 0)).toBe(before);
      }
    }
  }, 120000);
});
