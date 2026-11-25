import { type Card, createRng, fullDeck, rankValue, suitOf } from './cards';
import { HAND_RANKING } from './handRanking';
import { bestScore, CATEGORY_NAMES_FR, evaluateBest, HandCategory } from './evaluator';

/** Nom court d'une main de départ : « AKs », « QJo », « 77 ». */
export function startingHandName(hole: Card[]): string {
  const [a, b] = [...hole].sort((x, y) => rankValue(y) - rankValue(x));
  if (a[0] === b[0]) return a[0] + b[0];
  return a[0] + b[0] + (suitOf(a) === suitOf(b) ? 's' : 'o');
}

/**
 * Équité par simulation : on distribue au hasard les cartes inconnues
 * (mains des adversaires encore en jeu et cartes du tableau à venir) et on compte
 * la part du pot gagnée en moyenne.
 */
export function equity(hole: Card[], board: Card[], opponents: number, iterations = 2000, seed = 1): { win: number; tie: number; equity: number } {
  const known = new Set<string>([...hole, ...board]);
  const deck = fullDeck().filter((c) => !known.has(c));
  const rng = createRng(seed);
  let win = 0;
  let tie = 0;
  let eq = 0;
  const need = opponents * 2 + (5 - board.length);
  for (let it = 0; it < iterations; it++) {
    // tirage partiel de Fisher-Yates
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng() * (deck.length - i));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const fullBoard = board.concat(deck.slice(opponents * 2, need));
    const mine = bestScore([...hole, ...fullBoard]);
    let best = 0;
    let ties = 0;
    let lost = false;
    for (let o = 0; o < opponents; o++) {
      const s = bestScore([deck[o * 2], deck[o * 2 + 1], ...fullBoard]);
      if (s > mine) {
        lost = true;
        break;
      }
      if (s === mine) ties++;
      if (s > best) best = s;
    }
    if (lost) continue;
    if (ties === 0) {
      win++;
      eq += 1;
    } else {
      tie++;
      eq += 1 / (ties + 1);
    }
  }
  return { win: win / iterations, tie: tie / iterations, equity: eq / iterations };
}

export interface Out {
  card: Card;
  makes: string;
}

/**
 * Outs : cartes qui améliorent la catégorie de ta main à la prochaine carte
 * (en ignorant les améliorations qui ne profitent qu'au tableau).
 */
export function outs(hole: Card[], board: Card[]): Out[] {
  if (board.length < 3 || board.length > 4) return [];
  const known = new Set<string>([...hole, ...board]);
  const now = evaluateBest([...hole, ...board]).category;
  const res: Out[] = [];
  for (const c of fullDeck()) {
    if (known.has(c)) continue;
    const nb = [...board, c];
    const mine = evaluateBest([...hole, ...nb]).category;
    if (mine <= now) continue;
    const boardOnly = nb.length >= 5 ? evaluateBest(nb).category : -1;
    if (mine === boardOnly) continue;
    // une paire faite uniquement avec une carte du tableau n'est pas une vraie amélioration
    if (mine === HandCategory.Pair && !hole.some((h) => rankValue(h) === rankValue(c))) continue;
    res.push({ card: c, makes: CATEGORY_NAMES_FR[mine] });
  }
  return res;
}

/** Probabilité de toucher au moins un out (prochaine carte, et jusqu'à la river depuis le flop). */
export function hitChances(outCount: number, boardLen: number, holeLen = 2) {
  const unseen = 52 - holeLen - boardLen;
  const next = outCount / unseen;
  const byRiver = boardLen === 3 ? 1 - ((unseen - outCount) / unseen) * ((unseen - 1 - outCount) / (unseen - 1)) : next;
  return { next, byRiver };
}

/** Rang d'une main de départ parmi les 169 (0 = meilleure, 1 = pire). */
export function startingHandPercentile(hole: Card[]): number {
  const k = HAND_RANKING.indexOf(startingHandName(hole));
  return k < 0 ? 0.5 : k / (HAND_RANKING.length - 1);
}

/** Cote du pot : part minimale d'équité nécessaire pour qu'un call soit rentable. */
export const potOddsNeeded = (toCall: number, pot: number) => (toCall > 0 ? toCall / (pot + toCall) : 0);
