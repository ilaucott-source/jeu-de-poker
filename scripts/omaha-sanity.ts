/** Profil des bots à l'Omaha : mains jouées, relances, abattages (npx vite-node scripts/omaha-sanity.ts). */
import { createRng } from '../src/engine/cards';
import { applyAction, startHand, stacksAfter, type SeatInput } from '../src/engine/holdem';
import { BOT_STYLES, styledBot } from '../src/engine/bots';

const rng = createRng(11);
const styles = BOT_STYLES.slice(0, 9).filter((_, i) => i % 1 === 0).slice(0, 6);
const st0: Record<string, { hands: number; vpip: number; pfr: number; sd: number; net: number }> = {};
let seats: SeatInput[] = styles.map((s, i) => ({ id: `b${i}`, name: s.name, stack: 200 }));
const t0 = Date.now();
let slow = 0;
for (let n = 0; n < Number(process.argv[2] ?? 400); n++) {
  seats = seats.map((x) => (x.stack < 60 ? { ...x, stack: 200 } : x));
  const start = new Map(seats.map((x) => [x.id, x.stack]));
  let st = startHand(seats, { variant: 'omaha', structure: 'PL', smallBlind: 1, bigBlind: 2, buttonIndex: n % 6, seed: 900 + n });
  const did: Record<string, { v: boolean; r: boolean }> = {};
  while (st.toAct !== null) {
    const p = st.players[st.toAct];
    const t = Date.now();
    const a = styledBot(st, styles.find((s) => s.name === p.name)!, rng);
    if (Date.now() - t > 250) slow++;
    if (st.street === 'preflop') {
      did[p.name] ??= { v: false, r: false };
      if (a.type === 'call' || a.type === 'raise') did[p.name].v = true;
      if (a.type === 'raise') did[p.name].r = true;
    }
    st = applyAction(st, a);
  }
  for (const p of st.players) {
    const x = (st0[p.name] ??= { hands: 0, vpip: 0, pfr: 0, sd: 0, net: 0 });
    x.hands++;
    if (did[p.name]?.v) x.vpip++;
    if (did[p.name]?.r) x.pfr++;
    if (st.showdown?.[p.id]) x.sd++;
    x.net += p.stack - start.get(p.id)!;
  }
  seats = stacksAfter(st);
}
for (const [k, v] of Object.entries(st0)) console.log(k.padEnd(18), 'VPIP', Math.round((v.vpip / v.hands) * 100), 'PFR', Math.round((v.pfr / v.hands) * 100), 'SD', Math.round((v.sd / v.hands) * 100), 'BB/100', Math.round(((v.net / 2) / v.hands) * 100));
console.log('ms/main', Math.round((Date.now() - t0) / Number(process.argv[2] ?? 400)), 'décisions lentes', slow);
