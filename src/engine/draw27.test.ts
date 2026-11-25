import { describe, expect, it } from 'vitest';
import { createRng, type Card } from './cards';
import { applyAction, startHand, stacksAfter, type SeatInput } from './holdem';
import { BOT_STYLES, styledBot } from './bots';
import { describe27, planDraw, score27, top27 } from './lowball';
import { equity27 } from './draw27';
import { analyzeHand, scriptActions, replay } from './analysis';

const h = (s: string) => s.split(' ') as Card[];

describe('2-7 Triple Draw', () => {
  it('la main la plus basse gagne, As haut, quintes et couleurs contre soi', () => {
    expect(score27(h('7s 5d 4c 3h 2s'))).toBeLessThan(score27(h('8s 5d 4c 3h 2s')));
    expect(score27(h('8s 6d 4c 3h 2s'))).toBeLessThan(score27(h('8s 7d 4c 3h 2s')));
    expect(score27(h('As 5d 4c 3h 2s'))).toBeGreaterThan(score27(h('Ks Qd Jc 9h 7s'))); // A-5-4-3-2 n'est pas une quinte, mais l'As est haut
    expect(score27(h('6s 5d 4c 3h 2s'))).toBeGreaterThan(score27(h('As Kd Qc Jh 9s'))); // quinte : pire qu'une main sans paire
    expect(score27(h('7s 5s 4s 3s 2s'))).toBeGreaterThan(score27(h('Ks Qd Jc 9h 7s'))); // couleur
    expect(describe27(h('7s 5d 4c 3h 2s'))).toContain('meilleure');
    expect(describe27(h('9s 6d 4c 3h 2s'))).toBe('Main à 9 : 9-6-4-3-2');
  });
  it('choisit les bonnes cartes à changer', () => {
    expect(planDraw(h('7s 5d 4c 3h 2s'), 3)).toEqual([]);
    expect(planDraw(h('Ks 5d 4c 3h 2s'), 3)).toEqual([0]);
    expect(planDraw(h('7s 7d 4c 3h Qs'), 3).sort()).toEqual([1, 4]);
    expect(top27(h('7s 5d 4c 3h 2s'))).toBeLessThan(top27(h('Ks Qd 4c 3h 2s')));
  });
  it('estime l’équité contre un adversaire servi ou qui tire', () => {
    const vsPat = equity27(h('Ks 5d 4c 3h 2s'), [], 2, [{ id: 'x', name: 'x', draws: [1, 0], pre: 2, aggressive: true }], 400);
    const vsDraw3 = equity27(h('Ks 5d 4c 3h 2s'), [], 2, [{ id: 'x', name: 'x', draws: [3, 3], pre: 0, aggressive: false }], 400);
    expect(vsDraw3).toBeGreaterThan(vsPat);
  });
  it('les bots jouent des mains complètes (tirages compris), jetons conservés, rejouables', () => {
    const rng = createRng(9);
    const styles = BOT_STYLES.slice(0, 6);
    let seats: SeatInput[] = styles.map((s, i) => ({ id: `b${i}`, name: s.name, stack: 200 }));
    let draws = 0;
    for (let n = 0; n < 60; n++) {
      seats = seats.map((x) => (x.stack < 20 ? { ...x, stack: 200 } : x));
      const config = { variant: 'draw27' as const, structure: 'FL' as const, smallBlind: 1, bigBlind: 2, buttonIndex: n % 6, seed: 500 + n };
      let st = startHand(seats, config);
      expect(st.players.every((p) => p.holeCards.length === 5)).toBe(true);
      let guard = 0;
      while (st.toAct !== null && guard++ < 500) {
        const p = st.players[st.toAct];
        const a = styledBot(st, styles.find((s) => s.name === p.name)!, rng);
        if (a.type === 'draw') draws++;
        st = applyAction(st, a);
      }
      expect(st.street).toBe('complete');
      expect(st.board.length).toBe(0);
      const before = seats.reduce((a, x) => a + x.stack, 0);
      const script = { seats, config, actions: scriptActions(st) };
      const again = replay(script);
      expect(again[again.length - 1].players.map((p) => p.stack)).toEqual(st.players.map((p) => p.stack));
      if (n % 15 === 0) analyzeHand(script, 'b0', 100);
      seats = stacksAfter(st);
      expect(seats.reduce((a, x) => a + x.stack, 0)).toBe(before);
    }
    expect(draws).toBeGreaterThan(50);
  }, 120000);
});
