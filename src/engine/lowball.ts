import { type Card, rankValue } from './cards';
import { categoryOf, HandCategory, score5, type HandValue } from './evaluator';

/**
 * 2-7 (Deuce to Seven) : la main la plus BASSE gagne.
 * L'As est toujours haut, les quintes et les couleurs comptent contre toi.
 * Meilleure main : 7-5-4-3-2 de couleurs différentes.
 */

/** Score 2-7 : plus il est petit, meilleure est la main (pas de quinte « roue » A-2-3-4-5). */
export const score27 = (h: Card[]) => score5(h[0], h[1], h[2], h[3], h[4], false);

const RANK_TXT: Record<number, string> = { 14: 'A', 13: 'R', 12: 'D', 11: 'V', 10: '10' };
const txt = (r: number) => RANK_TXT[r] ?? String(r);
const LOW_CAT_FR: Partial<Record<HandCategory, string>> = {
  [HandCategory.Pair]: 'Paire',
  [HandCategory.TwoPair]: 'Double paire',
  [HandCategory.Trips]: 'Brelan',
  [HandCategory.Straight]: 'Quinte',
  [HandCategory.Flush]: 'Couleur',
  [HandCategory.FullHouse]: 'Full',
  [HandCategory.Quads]: 'Carré',
  [HandCategory.StraightFlush]: 'Quinte flush',
};

/** « Main à 8 : 8-6-5-3-2 », ou « Paire (perdante au 2-7) ». */
export function describe27(h: Card[]): string {
  const cat = categoryOf(score27(h));
  const ranks = h.map(rankValue).sort((a, b) => b - a);
  if (cat === HandCategory.HighCard) {
    const s = ranks.map(txt).join('-');
    if (s === '7-5-4-3-2') return '7-5-4-3-2, la meilleure main possible';
    return `Main à ${txt(ranks[0])} : ${s}`;
  }
  return `${LOW_CAT_FR[cat]} (compte contre toi au 2-7)`;
}

/** Valeur pour l'abattage : on inverse le score pour que « plus grand = gagne » comme dans le reste du moteur. */
export function value27(h: Card[]): HandValue {
  const s = score27(h);
  return { category: categoryOf(s), score: 10_000_000 - s, cards: h, label: describe27(h) };
}

/** Main « faite » : 5 rangs différents, sans quinte ni couleur. */
export const isMade27 = (h: Card[]) => categoryOf(score27(h)) === HandCategory.HighCard;

/**
 * Cartes à changer selon une stratégie solide et simple :
 * - servi (on garde tout) avec une main faite assez basse ;
 * - sinon on garde les cartes basses différentes (8 ou moins, 9 ou moins au dernier tirage), 4 au plus.
 * `drawsLeft` = tirages restants, celui-ci compris (3, 2 ou 1). Renvoie les positions des cartes à jeter.
 */
export function planDraw(hand: Card[], drawsLeft: number, loose = 0): number[] {
  const ranks = hand.map(rankValue);
  const patMax = (drawsLeft >= 2 ? 9 : 10) + loose;
  const made = isMade27(hand);
  if (made && Math.max(...ranks) <= patMax) return [];
  const keepMax = (drawsLeft >= 2 ? 8 : 9) + loose;
  const order = ranks.map((r, i) => ({ r, i })).sort((a, b) => a.r - b.r);
  const keep = new Set<number>();
  const seen = new Set<number>();
  for (const { r, i } of order) {
    if (keep.size >= 4) break;
    if (r > keepMax || seen.has(r)) continue;
    seen.add(r);
    keep.add(i);
  }
  return hand.map((_, i) => i).filter((i) => !keep.has(i));
}

/** Force d'une main avant le premier tirage, en « top X % » approximatif (0 = la meilleure). */
export function top27(hand: Card[]): number {
  const d = planDraw(hand, 3);
  const kept = hand.filter((_, i) => !d.includes(i)).map(rankValue);
  const hi = kept.length ? Math.max(...kept) : 15;
  const n = d.length;
  // la deuxième carte la plus haute départage (7-6 est moins bien que 7-4)
  const second = kept.sort((a, b) => b - a)[1] ?? 0;
  const tie = (second - 2) / 120;
  if (n === 0) return (hi <= 7 ? 0.005 : hi === 8 ? 0.02 : hi === 9 ? 0.07 : 0.15) + tie;
  if (n === 1) return (hi <= 7 ? 0.03 : hi === 8 ? 0.09 : 0.2) + tie;
  if (n === 2) return (hi <= 6 ? 0.14 : hi === 7 ? 0.2 : 0.32) + tie;
  if (n === 3) return 0.5 + tie;
  return 0.85;
}

/** Description d'un tirage : « tu tires 1 carte à 7-5-3-2 ». */
export function drawText(hand: Card[], discard: number[]): string {
  if (!discard.length) return 'servi (tu gardes tes 5 cartes)';
  const kept = hand.filter((_, i) => !discard.includes(i)).map(rankValue).sort((a, b) => b - a);
  const n = discard.length;
  return `tirer ${n} carte${n > 1 ? 's' : ''}${kept.length ? ` à ${kept.map(txt).join('-')}` : ''}`;
}
