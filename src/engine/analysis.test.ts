import { describe, expect, it } from 'vitest';
import { createRng } from './cards';
import { applyAction, startHand, type HandConfig, type SeatInput } from './holdem';
import { BOT_STYLES, styledBot } from './bots';
import { analyzeHand, replay, scriptActions } from './analysis';

describe('historique et analyse', () => {
  it('rejoue une main à l’identique et analyse les décisions du joueur', () => {
    const rng = createRng(9);
    let analysed = 0;
    for (let h = 0; h < 25; h++) {
      const seats: SeatInput[] = BOT_STYLES.slice(0, 6).map((b, i) => ({ id: i === 0 ? 'hero' : `b${i}`, name: b.name, stack: 200 }));
      const config: HandConfig = { structure: 'NL', smallBlind: 1, bigBlind: 2, buttonIndex: h % 6, seed: 1000 + h };
      let st = startHand(seats, config);
      while (st.toAct !== null) st = applyAction(st, styledBot(st, BOT_STYLES[st.toAct], rng));
      const script = { seats, config, actions: scriptActions(st) };
      const all = replay(script);
      const again = all[all.length - 1];
      expect(again.board).toEqual(st.board);
      expect(again.players.map((p) => p.stack)).toEqual(st.players.map((p) => p.stack));
      const d = analyzeHand(script, 'hero', 150);
      const heroActs = st.log.filter((a) => a.playerId === 'hero' && a.type !== 'post').length;
      expect(d.length).toBeLessThanOrEqual(heroActs);
      analysed += d.length;
      for (const x of d) expect(x.title.length).toBeGreaterThan(5);
    }
    expect(analysed).toBeGreaterThan(10);
  }, 60000);
});
