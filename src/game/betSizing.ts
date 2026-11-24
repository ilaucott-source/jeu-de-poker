import { type HandState, type LegalActions, potTotal } from '../engine/holdem';

export interface BetPreset {
  label: string;
  to: number;
}

const clamp = (v: number, legal: LegalActions) => Math.max(legal.minTo, Math.min(legal.maxTo, Math.round(v)));

/**
 * Montants rapides adaptés à la situation :
 * ouverture préflop en BB, 3-bet / 4-bet en multiple de la relance,
 * fractions du pot après le flop, et tapis.
 */
export function betPresets(state: HandState, legal: LegalActions): BetPreset[] {
  if (!legal.canBetOrRaise || state.config.structure === 'FL' || legal.maxTo <= legal.minTo) return [];
  const bb = state.config.bigBlind;
  const p = state.players[state.toAct!];
  const pot = potTotal(state);
  const toCall = state.currentBet - p.bet;
  const potRaiseTo = state.currentBet + pot + toCall;
  const list: BetPreset[] = [];

  if (state.street === 'preflop') {
    const raises = state.betsThisStreet; // 1 = seulement la grosse blind
    if (raises <= 1) {
      const limpers = state.players.filter((o) => !o.folded && o.bet === state.currentBet).length - 2;
      const extra = Math.max(0, limpers) * bb;
      list.push({ label: '2,5 BB', to: 2.5 * bb + extra }, { label: '3 BB', to: 3 * bb + extra }, { label: '4 BB', to: 4 * bb + extra });
    } else {
      const name = raises === 2 ? '3-bet' : raises === 3 ? '4-bet' : `${raises + 1}-bet`;
      const mults = raises === 2 ? [3, 4] : [2.2, 2.5];
      for (const m of mults) list.push({ label: `${name} ×${String(m).replace('.', ',')}`, to: state.currentBet * m });
    }
  } else if (legal.isBet) {
    list.push({ label: '⅓ pot', to: pot / 3 }, { label: '½ pot', to: pot / 2 }, { label: '⅔ pot', to: (pot * 2) / 3 });
  } else {
    list.push({ label: 'Relance ×2,5', to: state.currentBet * 2.5 }, { label: 'Relance ×3', to: state.currentBet * 3 });
  }
  list.push({ label: 'Pot', to: potRaiseTo });
  if (state.config.structure === 'NL') list.push({ label: 'Tapis', to: legal.maxTo });

  const seen = new Set<number>();
  return list
    .map((b) => ({ ...b, to: clamp(b.to, legal) }))
    .filter((b) => (seen.has(b.to) ? false : (seen.add(b.to), true)));
}

/** Curseur progressif : précis pour les petites mises, rapide vers le tapis. */
const CURVE = 2.6;
export const sliderToAmount = (t: number, legal: LegalActions) =>
  clamp(legal.minTo + (legal.maxTo - legal.minTo) * Math.pow(t, CURVE), legal);
export const amountToSlider = (v: number, legal: LegalActions) =>
  legal.maxTo === legal.minTo ? 0 : Math.pow((v - legal.minTo) / (legal.maxTo - legal.minTo), 1 / CURVE);
