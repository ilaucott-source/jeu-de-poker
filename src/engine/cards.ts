export const RANKS = '23456789TJQKA' as const;
export const SUITS = 'cdhs' as const;

export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];
/** Une carte au format "As", "Td", "7c"… */
export type Card = `${Rank}${Suit}`;

export function rankValue(card: Card): number {
  return RANKS.indexOf(card[0] as Rank) + 2; // 2..14
}

export function suitOf(card: Card): Suit {
  return card[1] as Suit;
}

export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(`${r}${s}` as Card);
  return deck;
}

/** Générateur pseudo-aléatoire reproductible (mulberry32) : permet de rejouer une main à l'identique. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
