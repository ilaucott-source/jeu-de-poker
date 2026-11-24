import { describe, expect, it } from 'vitest';
import { createRng } from './cards';
import { applyAction, startHand, stacksAfter, type BettingStructure, type SeatInput } from './holdem';
import { BOT_STYLES, pickBots, styledBot } from './bots';

function run(structure: BettingStructure, hands: number, seed: number) {
  const rng = createRng(seed);
  const styles = BOT_STYLES.slice(0, 6);
  let seats: SeatInput[] = styles.map((s, i) => ({ id: `b${i}`, name: s.name, stack: 200 }));
  const vpip: Record<string, number> = {};
  for (let h = 0; h < hands; h++) {
    seats = seats.map((x) => (x.stack < 20 ? { ...x, stack: 200 } : x));
    let st = startHand(seats, { structure, smallBlind: 1, bigBlind: 2, buttonIndex: h % 6, seed: seed + h });
    let guard = 0;
    while (st.toAct !== null && guard++ < 500) {
      const p = st.players[st.toAct];
      const a = styledBot(st, styles.find((s) => s.name === p.name)!, rng);
      if (st.street === 'preflop' && (a.type === 'call' || a.type === 'raise')) vpip[p.name] = (vpip[p.name] ?? 0) + 1;
      st = applyAction(st, a);
    }
    expect(st.street).toBe('complete');
    const before = seats.reduce((a, x) => a + x.stack, 0);
    seats = stacksAfter(st);
    expect(seats.reduce((a, x) => a + x.stack, 0)).toBe(before);
  }
  return vpip;
}

describe('bots à personnalité', () => {
  it('jouent des centaines de mains sans erreur, dans les trois structures', () => {
    const v = run('NL', 150, 1);
    run('PL', 50, 2);
    run('FL', 50, 3);
    expect(v['Le Débutant']).toBeGreaterThan(v['La Prudente'] * 2);
  }, 60000);
  it('choisit les adversaires selon le niveau', () => {
    expect(pickBots('expert', 2).map((b) => b.name)).toEqual(['Le Mystère', 'Le Vétéran']);
    expect(new Set(pickBots('mix', 5, 42).map((b) => b.name)).size).toBe(5);
  });
});
