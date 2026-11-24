import { type Card, rankValue, suitOf } from './cards';

export const HandCategory = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  Trips: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  Quads: 7,
  StraightFlush: 8,
} as const;
export type HandCategory = (typeof HandCategory)[keyof typeof HandCategory];

export const CATEGORY_NAMES_FR: Record<HandCategory, string> = {
  [HandCategory.HighCard]: 'Hauteur',
  [HandCategory.Pair]: 'Paire',
  [HandCategory.TwoPair]: 'Double paire',
  [HandCategory.Trips]: 'Brelan',
  [HandCategory.Straight]: 'Quinte',
  [HandCategory.Flush]: 'Couleur',
  [HandCategory.FullHouse]: 'Full',
  [HandCategory.Quads]: 'Carré',
  [HandCategory.StraightFlush]: 'Quinte flush',
};

export interface HandValue {
  category: HandCategory;
  /** Score comparable : plus grand = meilleure main. */
  score: number;
  /** Les 5 cartes qui forment la main. */
  cards: Card[];
}

function encode(category: number, kickers: number[]): number {
  let s = category;
  for (let i = 0; i < 5; i++) s = s * 15 + (kickers[i] ?? 0);
  return s;
}

/** Hauteur de la quinte (5 pour la roue A-2-3-4-5), ou 0. */
function straightHigh(uniqueDesc: number[]): number {
  const vals = uniqueDesc.includes(14) ? [...uniqueDesc, 1] : uniqueDesc;
  let run = 1;
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] === vals[i - 1] - 1) {
      run++;
      if (run >= 5) return vals[i] + 4;
    } else run = 1;
  }
  return 0;
}

export function evaluate5(cards: Card[]): HandValue {
  const values = cards.map(rankValue).sort((a, b) => b - a);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
  const unique = [...new Set(values)];
  const sHigh = unique.length === 5 ? straightHigh(unique) : 0;

  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  // groupes triés par taille puis par valeur
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byGroup = groups.map((g) => g[0]);

  let category: HandCategory;
  let kickers: number[];
  if (sHigh && flush) {
    category = HandCategory.StraightFlush;
    kickers = [sHigh];
  } else if (groups[0][1] === 4) {
    category = HandCategory.Quads;
    kickers = byGroup;
  } else if (groups[0][1] === 3 && groups[1][1] === 2) {
    category = HandCategory.FullHouse;
    kickers = byGroup;
  } else if (flush) {
    category = HandCategory.Flush;
    kickers = values;
  } else if (sHigh) {
    category = HandCategory.Straight;
    kickers = [sHigh];
  } else if (groups[0][1] === 3) {
    category = HandCategory.Trips;
    kickers = byGroup;
  } else if (groups[0][1] === 2 && groups[1][1] === 2) {
    category = HandCategory.TwoPair;
    kickers = byGroup;
  } else if (groups[0][1] === 2) {
    category = HandCategory.Pair;
    kickers = byGroup;
  } else {
    category = HandCategory.HighCard;
    kickers = values;
  }
  return { category, score: encode(category, kickers), cards };
}

/** Meilleure main de 5 cartes parmi 5 à 7 cartes (Texas Hold'em). */
export function evaluateBest(cards: Card[]): HandValue {
  if (cards.length < 5) throw new Error('Il faut au moins 5 cartes');
  let best: HandValue | null = null;
  const n = cards.length;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            const v = evaluate5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || v.score > best.score) best = v;
          }
  return best!;
}

export function describeHand(v: HandValue): string {
  return CATEGORY_NAMES_FR[v.category];
}
