import { type Card, rankValue, suitOf } from './cards';
import { evaluateBest, HandCategory } from './evaluator';
import { legalActions, type HandState, type PlayerAction, potTotal } from './holdem';

/** Force d'une main de départ entre 0 et 1 (heuristique simple). */
export function preflopStrength(cards: Card[]): number {
  const [a, b] = cards.map(rankValue).sort((x, y) => y - x);
  const suited = suitOf(cards[0]) === suitOf(cards[1]);
  let s: number;
  if (a === b) s = 0.5 + (a - 2) / 24; // 22 = 0.5, AA = 1
  else {
    s = (a + b - 5) / 40 + (a >= 13 ? 0.12 : 0);
    if (suited) s += 0.06;
    const gap = a - b - 1;
    s -= Math.min(gap, 4) * 0.025;
  }
  return Math.max(0, Math.min(1, s));
}

/** Force après le flop entre 0 et 1, selon la catégorie de main obtenue. */
export function postflopStrength(hole: Card[], board: Card[]): number {
  const v = evaluateBest([...hole, ...board]);
  const boardOnly = board.length >= 5 ? evaluateBest(board).category : -1;
  const base: Record<HandCategory, number> = {
    [HandCategory.HighCard]: 0.1,
    [HandCategory.Pair]: 0.4,
    [HandCategory.TwoPair]: 0.65,
    [HandCategory.Trips]: 0.75,
    [HandCategory.Straight]: 0.82,
    [HandCategory.Flush]: 0.86,
    [HandCategory.FullHouse]: 0.93,
    [HandCategory.Quads]: 0.98,
    [HandCategory.StraightFlush]: 1,
  };
  let s = base[v.category];
  if (v.category === HandCategory.Pair) {
    const top = Math.max(...board.map(rankValue));
    const pairRank = v.cards.map(rankValue).find((r, i, arr) => arr.indexOf(r) !== i)!;
    if (pairRank >= top) s += 0.15;
    if (!hole.some((c) => rankValue(c) === pairRank)) s -= 0.25; // paire du board
  }
  if (v.category === boardOnly) s -= 0.3; // on joue le board
  return Math.max(0, Math.min(1, s));
}

/** Bot "simple" de l'étape 1 : joue selon la force de sa main, avec un peu de hasard. */
export function simpleBot(state: HandState, rng: () => number = Math.random): PlayerAction {
  const legal = legalActions(state)!;
  const p = state.players[state.toAct!];
  const strength = state.street === 'preflop' ? preflopStrength(p.holeCards) : postflopStrength(p.holeCards, state.board);
  const pot = potTotal(state);
  const potOdds = legal.callAmount / (pot + legal.callAmount || 1);
  const noise = (rng() - 0.5) * 0.15;
  const s = strength + noise;

  if (legal.canBetOrRaise && s > 0.72) {
    const target = legal.isBet ? Math.round(pot * (0.5 + rng() * 0.3)) : state.currentBet * (2.5 + rng());
    const to = Math.max(legal.minTo, Math.min(legal.maxTo, Math.round(target)));
    return { type: legal.isBet ? 'bet' : 'raise', to };
  }
  if (legal.canCheck) {
    if (legal.canBetOrRaise && rng() < 0.08) return { type: 'bet', to: legal.minTo }; // petit bluff
    return { type: 'check' };
  }
  if (s > potOdds + 0.15 || (s > 0.45 && potOdds < 0.25)) return { type: 'call' };
  return { type: 'fold' };
}
