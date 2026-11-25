import { describe, expect, it } from 'vitest';
import { startHand, applyAction } from './holdem';
import { BOT_STYLES } from './bots';
import { thinkTime } from './thinking';

describe('temps de réflexion', () => {
  it('rapide pour un fold évident, long pour un gros call', () => {
    const seats = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: BOT_STYLES[i].name, stack: 200 }));
    const s = startHand(seats, { structure: 'NL', smallBlind: 1, bigBlind: 2, buttonIndex: 0, seed: 4 });
    const pro = BOT_STYLES[6];
    const folds = Array.from({ length: 50 }, () => thinkTime(s, pro, { type: 'fold' }, 'normal'));
    expect(Math.max(...folds)).toBeLessThan(2500);
    expect(Math.min(...folds)).toBeGreaterThanOrEqual(600);
    const shove = applyAction(s, { type: 'raise', to: 200 });
    const calls = Array.from({ length: 50 }, () => thinkTime(shove, pro, { type: 'call' }, 'normal'));
    expect(Math.min(...calls)).toBeGreaterThan(4000);
    expect(Math.max(...calls)).toBeLessThanOrEqual(14000);
  });
});
