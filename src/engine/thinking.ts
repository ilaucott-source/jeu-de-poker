import { legalActions, potTotal, type HandState, type PlayerAction } from './holdem';
import type { BotStyle } from './bots';

export type BotPace = 'rapide' | 'normal' | 'realiste';
export const PACE: Record<BotPace, { label: string; factor: number; hint: string }> = {
  rapide: { label: 'Rapide', factor: 0.45, hint: 'Les adversaires jouent vite : 1 à 4 secondes.' },
  normal: { label: 'Normal', factor: 1, hint: 'Comme à une vraie table : 1 à 3 secondes pour les coups évidents, jusqu’à 8 à 10 pour les gros.' },
  realiste: { label: 'Posé', factor: 1.35, hint: 'Les adversaires prennent leur temps, jusqu’à une douzaine de secondes sur les grosses décisions.' },
};

/**
 * Temps de réflexion d'un bot, en millisecondes, selon la difficulté du coup :
 * se coucher avec une main faible est rapide, payer ou relancer un gros pot prend du temps.
 */
export function thinkTime(state: HandState, style: BotStyle, action: PlayerAction, pace: BotPace, rng: () => number = Math.random): number {
  if (action.type === 'draw') {
    // 2-7 : choisir ses cartes à changer va vite, sauf les décisions serrées (casser une main faite)
    const s = (action.discard.length === 0 ? 1.2 : 1 + action.discard.length * 0.35) + rng() * 1.5;
    return Math.round(Math.min(6, s * PACE[pace].factor) * 1000);
  }
  const legal = legalActions(state)!;
  const me = state.players[state.toAct!];
  const bb = state.config.bigBlind;
  const pot = potTotal(state);
  const toCall = legal.callAmount;
  const pressure = toCall > 0 ? toCall / Math.max(pot, bb) : 0; // part du pot à payer
  const stackShare = (toCall + (action.type === 'bet' || action.type === 'raise' ? action.to - me.bet : 0)) / Math.max(1, me.stack + me.bet);
  const preflop = state.street === 'preflop';
  const raisesPre = state.log.filter((a) => a.street === 'preflop' && a.type === 'raise').length;

  let s: number; // secondes
  switch (action.type) {
    case 'fold':
      // coucher une main sans intérêt va vite ; abandonner face à une grosse mise demande réflexion
      s = preflop && raisesPre <= 1 ? 0.9 + rng() * 1.2 : 1.8 + rng() * 2 + pressure * 3;
      break;
    case 'check':
      s = 1 + rng() * 1.8;
      break;
    case 'call':
      s = (preflop ? 1.6 : 2.4) + rng() * 2.4 + pressure * 3;
      break;
    default:
      s = (preflop ? 2 : 2.8) + rng() * 2.6 + Math.min(1, ((action as { to: number }).to - state.currentBet) / Math.max(pot, bb)) * 1.5;
  }
  // les grosses décisions : river, tapis, gros pot
  if (state.street === 'river' && action.type !== 'check') s += 1 + rng() * 1.5;
  if (stackShare > 0.4) s += 2 + rng() * 3;
  if (pot > 40 * bb) s += 1 + rng();
  // de temps en temps, une longue hésitation (le « tank »)
  if (action.type !== 'fold' && action.type !== 'check' && rng() < 0.07) s += 3 + rng() * 3;
  // chaque personnage a son tempo : le débutant hésite, le fêtard joue vite, les experts sont réguliers
  const tempo: Record<string, number> = { 'Le Débutant': 1.15, 'La Prudente': 1.2, 'Le Fêtard': 0.75, 'Le Cow-boy': 0.85, 'La Calculatrice': 1.1, 'Le Vétéran': 1.1 };
  s *= tempo[style.name] ?? 1;
  s *= PACE[pace].factor;
  return Math.round(Math.min(14, Math.max(0.6, s)) * 1000);
}
