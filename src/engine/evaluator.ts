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

const RV: Record<string, number> = {};
const SV: Record<string, number> = {};
'23456789TJQKA'.split('').forEach((r, i) => 'cdhs'.split('').forEach((s, j) => {
  RV[r + s] = i + 2;
  SV[r + s] = j;
}));

/** Score seul d'une main de 5 cartes (identique à evaluate5(...).score), sans allocation inutile : pour les simulations. */
export function score5(c0: Card, c1: Card, c2: Card, c3: Card, c4: Card): number {
  const v = [RV[c0], RV[c1], RV[c2], RV[c3], RV[c4]];
  // tri décroissant par insertion
  for (let i = 1; i < 5; i++) {
    const x = v[i];
    let j = i - 1;
    while (j >= 0 && v[j] < x) {
      v[j + 1] = v[j];
      j--;
    }
    v[j + 1] = x;
  }
  const s0 = SV[c0];
  const flush = SV[c1] === s0 && SV[c2] === s0 && SV[c3] === s0 && SV[c4] === s0;
  const distinct = v[0] !== v[1] && v[1] !== v[2] && v[2] !== v[3] && v[3] !== v[4];
  let sHigh = 0;
  if (distinct) {
    if (v[0] - v[4] === 4) sHigh = v[0];
    else if (v[0] === 14 && v[1] === 5 && v[4] === 2) sHigh = 5;
  }
  const B = 759375; // 15^5
  if (sHigh) return (flush ? 8 : 4) * B + sHigh * 50625;
  if (flush) return 5 * B + v[0] * 50625 + v[1] * 3375 + v[2] * 225 + v[3] * 15 + v[4];
  if (distinct) return v[0] * 50625 + v[1] * 3375 + v[2] * 225 + v[3] * 15 + v[4];
  // groupes (valeurs déjà triées) : taille décroissante puis valeur décroissante
  const gv: number[] = [];
  const gc: number[] = [];
  for (let i = 0; i < 5; i++) {
    if (i > 0 && v[i] === v[i - 1]) gc[gc.length - 1]++;
    else {
      gv.push(v[i]);
      gc.push(1);
    }
  }
  for (let i = 1; i < gv.length; i++) {
    const c = gc[i];
    const x = gv[i];
    let j = i - 1;
    while (j >= 0 && gc[j] < c) {
      gc[j + 1] = gc[j];
      gv[j + 1] = gv[j];
      j--;
    }
    gc[j + 1] = c;
    gv[j + 1] = x;
  }
  const cat = gc[0] === 4 ? 7 : gc[0] === 3 ? (gc[1] === 2 ? 6 : 3) : gc[1] === 2 ? 2 : 1;
  let sc = cat;
  for (let i = 0; i < 5; i++) sc = sc * 15 + (gv[i] ?? 0);
  return sc;
}

export const categoryOf = (score: number) => Math.floor(score / 759375) as HandCategory;

/** Meilleur score de 5 cartes parmi 5 à 7 cartes (Texas Hold'em). */
export function bestScore(cards: Card[]): number {
  const n = cards.length;
  let best = -1;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            const s = score5(cards[a], cards[b], cards[c], cards[d], cards[e]);
            if (s > best) best = s;
          }
  return best;
}

/** Meilleure main de 5 cartes parmi 5 à 7 cartes (Texas Hold'em). */
export function evaluateBest(cards: Card[]): HandValue {
  if (cards.length < 5) throw new Error('Il faut au moins 5 cartes');
  let best = -1;
  let pick: Card[] = [];
  const n = cards.length;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            const s = score5(cards[a], cards[b], cards[c], cards[d], cards[e]);
            if (s > best) {
              best = s;
              pick = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            }
          }
  return evaluate5(pick);
}

/** Omaha : meilleur score en utilisant exactement 2 cartes privatives et 3 cartes du tableau. */
export function omahaScore(hole: Card[], board: Card[]): number {
  let best = -1;
  const h = hole.length;
  const b = board.length;
  for (let i = 0; i < h - 1; i++)
    for (let j = i + 1; j < h; j++)
      for (let x = 0; x < b - 2; x++)
        for (let y = x + 1; y < b - 1; y++)
          for (let z = y + 1; z < b; z++) {
            const s = score5(hole[i], hole[j], board[x], board[y], board[z]);
            if (s > best) best = s;
          }
  return best;
}

/** Omaha : meilleure main (2 cartes privatives exactement + 3 du tableau). */
export function evaluateOmaha(hole: Card[], board: Card[]): HandValue {
  if (board.length < 3) throw new Error('Il faut au moins 3 cartes au tableau');
  let best = -1;
  let pick: Card[] = [];
  const h = hole.length;
  const b = board.length;
  for (let i = 0; i < h - 1; i++)
    for (let j = i + 1; j < h; j++)
      for (let x = 0; x < b - 2; x++)
        for (let y = x + 1; y < b - 1; y++)
          for (let z = y + 1; z < b; z++) {
            const s = score5(hole[i], hole[j], board[x], board[y], board[z]);
            if (s > best) {
              best = s;
              pick = [hole[i], hole[j], board[x], board[y], board[z]];
            }
          }
  return evaluate5(pick);
}

export function describeHand(v: HandValue): string {
  return CATEGORY_NAMES_FR[v.category];
}
