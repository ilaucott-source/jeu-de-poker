import type { Card } from './cards';
import { CATEGORY_NAMES_FR, evaluateBest, evaluateOmaha, type HandValue } from './evaluator';
import type { GameVariant, HandState } from './holdem';
import { outs as holdemOuts, startingHandName, type Out } from './odds';
import { omahaClass, omahaEquityVsRanges, omahaName, omahaOuts } from './omaha';
import { equityVsRanges, handClass, type RangeSpec } from './ranges';

export type { GameVariant };

export const VARIANT_FR: Record<GameVariant, string> = { holdem: "Texas Hold'em", omaha: 'Omaha' };

export const variantOf = (h: { config: { variant?: GameVariant } }): GameVariant => h.config.variant ?? 'holdem';
export const isOmaha = (h: HandState) => h.config.variant === 'omaha';

/** Meilleure main selon le jeu (à l'Omaha : 2 cartes de la main exactement). */
export function bestHand(variant: GameVariant, hole: Card[], board: Card[]): HandValue {
  return variant === 'omaha' ? evaluateOmaha(hole, board) : evaluateBest([...hole, ...board]);
}
export const madeHandFr = (variant: GameVariant, hole: Card[], board: Card[]) => CATEGORY_NAMES_FR[bestHand(variant, hole, board).category];

export function equityFor(variant: GameVariant, hole: Card[], board: Card[], ranges: RangeSpec[], iterations: number, seed: number): number {
  return variant === 'omaha' ? omahaEquityVsRanges(hole, board, ranges, Math.max(60, Math.round(iterations * 0.45)), seed) : equityVsRanges(hole, board, ranges, iterations, seed);
}
export const classFor = (variant: GameVariant, hole: Card[], board: Card[]) => (variant === 'omaha' ? omahaClass(hole, board) : handClass(hole, board));
export const outsFor = (variant: GameVariant, hole: Card[], board: Card[]): Out[] => (variant === 'omaha' ? omahaOuts(hole, board) : holdemOuts(hole, board));
export const handNameFor = (hole: Card[]) => (hole.length === 4 ? omahaName(hole) : hole.length === 2 ? startingHandName(hole) : '');
