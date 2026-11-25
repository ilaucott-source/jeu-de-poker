/** Mesure les décisions absurdes des bots sur des milliers de mains (npx vite-node scripts/bot-sanity.ts). */
import { createRng } from '../src/engine/cards';
import { applyAction, legalActions, potTotal, startHand, stacksAfter, type SeatInput } from '../src/engine/holdem';
import { BOT_STYLES, pickBots, styledBot } from '../src/engine/bots';
import { startingHandName } from '../src/engine/odds';
import { handClass, topPercent } from '../src/engine/ranges';

const level = (process.argv[2] ?? 'moyen') as 'moyen';
const tourney = process.argv[3] === 't';
const rng = createRng(99);
const styles = pickBots(level, 6, 7);
const stats: Record<string, number> = {};
const inc = (k: string) => (stats[k] = (stats[k] ?? 0) + 1);
let seats: SeatInput[] = styles.map((s, i) => ({ id: `b${i}`, name: s.name, stack: tourney ? 1500 : 200 }));
for (let h = 0; h < 3000; h++) {
  if (tourney && h % 150 === 0) seats = styles.map((s, i) => ({ id: `b${i}`, name: s.name, stack: 1500 }));
  if (!tourney) seats = seats.map((x) => (x.stack < 40 ? { ...x, stack: 200 } : x));
  const lvl = tourney ? Math.min(10, Math.floor((h % 150) / 12)) : 0;
  const bbs = [20, 30, 50, 100, 150, 200, 300, 400, 600, 800, 1200];
  const bb = tourney ? bbs[lvl] : 2;
  const alive = seats.filter((s) => s.stack > 0).length;
  if (alive < 2) { seats = styles.map((s, i) => ({ id: `b${i}`, name: s.name, stack: 1500 })); continue; }
  let st = startHand(seats, { structure: 'NL', smallBlind: bb / 2, bigBlind: bb, buttonIndex: h % 6, seed: 1000 + h, tourney: tourney ? { payouts: [0.5, 0.3, 0.2] } : undefined });
  if (st.toAct === null && st.street === 'complete') { seats = stacksAfter(st); continue; }
  let g = 0;
  while (st.toAct !== null && g++ < 400) {
    const p = st.players[st.toAct];
    const s = BOT_STYLES.find((x) => x.name === p.name)!;
    const a = styledBot(st, s, rng);
    const legal = legalActions(st)!;
    const name = startingHandName(p.holeCards);
    const deep = (p.stack + p.bet) / bb;
    inc('actions');
    if (st.street === 'preflop') {
      if ((a.type === 'raise' || a.type === 'bet') && a.to >= p.stack + p.bet && deep > 30 && topPercent(name) > 0.08) { inc('shove-deep-weak'); if (process.env.V) console.log(p.name, name, Math.round(deep), st.log.filter((x) => x.street === 'preflop' && x.type !== 'post').map((x) => x.type + (x.amount ? x.amount / bb : '')).join(' ')); }
      if (a.type === 'call' && legal.callAmount >= p.stack * 0.5 && deep > 30 && topPercent(name) > 0.15) inc('call-big-weak-pre');
    } else {
      const cls = handClass(p.holeCards, st.board);
      if ((a.type === 'raise' || a.type === 'bet') && a.to >= (p.stack + p.bet) * 0.95 && cls === 0) inc('shove-air-post');
      if (a.type === 'call' && legal.callAmount >= p.stack * 0.5 && cls <= 1 && st.board.length === 5) inc('call-big-air-river');
      if (a.type === 'call' && legal.callAmount >= p.stack * 0.5 && cls <= 2) inc('call-big-weakpair');
      if (a.type === 'raise' && cls === 0 && legal.callAmount > potTotal(st) * 0.3) inc('raise-air-vs-bet');
    }
    st = applyAction(st, a);
  }
  seats = stacksAfter(st);
}
console.log(level, tourney ? 'tournoi' : 'cash', stats);
