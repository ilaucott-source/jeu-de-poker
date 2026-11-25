import { type Card, fullDeck, rankValue, suitOf } from './cards';
import { evaluateBest, HandCategory } from './evaluator';

export interface FlopOdds {
  /** paire ou mieux en utilisant au moins une de tes cartes */
  pairPlus: number;
  twoPairPlus: number;
  tripsPlus: number;
  straightPlus: number;
  flushPlus: number;
  flushDraw: number;
  straightDraw: number;
}

/** Une combinaison représentative d'une classe de mains (« AKs » → As Ks). */
export function exampleCards(name: string): Card[] {
  const [a, b] = [name[0], name[1]];
  if (name.length === 2) return [`${a}s`, `${b}h`] as Card[];
  return name.endsWith('s') ? ([`${a}s`, `${b}s`] as Card[]) : ([`${a}s`, `${b}h`] as Card[]);
}

/** Probabilités exactes au flop (les 19 600 flops possibles sont passés en revue). */
export function flopOdds(hole: Card[]): FlopOdds {
  const deck = fullDeck().filter((c) => !hole.includes(c));
  const n = deck.length;
  const r = { pairPlus: 0, twoPairPlus: 0, tripsPlus: 0, straightPlus: 0, flushPlus: 0, flushDraw: 0, straightDraw: 0 };
  const hr = hole.map(rankValue);
  const pocket = hr[0] === hr[1];
  let total = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++) {
        total++;
        const flop = [deck[i], deck[j], deck[k]];
        const v = evaluateBest([...hole, ...flop]);
        const fr = flop.map(rankValue);
        const uses = pocket || fr.includes(hr[0]) || fr.includes(hr[1]);
        const c = v.category;
        if (c >= HandCategory.Straight) {
          r.pairPlus++;
          r.twoPairPlus++;
          r.tripsPlus++;
          r.straightPlus++;
          if (c === HandCategory.Flush || c === HandCategory.StraightFlush) r.flushPlus++;
          continue;
        }
        if (uses && c >= HandCategory.Pair) r.pairPlus++;
        const both = !pocket && fr.includes(hr[0]) && fr.includes(hr[1]);
        const trips = c >= HandCategory.Trips && (pocket ? fr.includes(hr[0]) : fr.includes(hr[0]) || fr.includes(hr[1]));
        if (trips) r.tripsPlus++;
        if (trips || (c === HandCategory.TwoPair && both)) r.twoPairPlus++;
        // tirages (sans main faite au moins quinte)
        const cards = [...hole, ...flop];
        for (const s of 'cdhs') {
          if (cards.filter((x) => suitOf(x) === s).length === 4 && hole.some((x) => suitOf(x) === s)) {
            r.flushDraw++;
            break;
          }
        }
        const ranks = new Set(cards.map(rankValue));
        if (ranks.has(14)) ranks.add(1);
        let oesd = false;
        for (let lo = 1; lo <= 11 && !oesd; lo++) {
          // quatre cartes consécutives ouvertes des deux côtés
          if ([0, 1, 2, 3].every((d) => ranks.has(lo + d)) && lo > 1 && lo + 3 < 14) {
            const mine = [0, 1, 2, 3].some((d) => hr.includes(lo + d) || (lo + d === 1 && hr.includes(14)));
            if (mine) oesd = true;
          }
        }
        if (oesd) r.straightDraw++;
      }
  const f = (x: number) => x / total;
  return {
    pairPlus: f(r.pairPlus),
    twoPairPlus: f(r.twoPairPlus),
    tripsPlus: f(r.tripsPlus),
    straightPlus: f(r.straightPlus),
    flushPlus: f(r.flushPlus),
    flushDraw: f(r.flushDraw),
    straightDraw: f(r.straightDraw),
  };
}
