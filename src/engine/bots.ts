import { createRng, type Card } from './cards';
import { legalActions, potTotal, type HandState, type PlayerAction } from './holdem';
import { outs, startingHandName } from './odds';
import { postflopStrength } from './bot';
import { equityVsRanges, estimateRanges, openRange, positionOf, topPercent } from './ranges';

export type BotLevel = 'facile' | 'moyen' | 'difficile' | 'expert';

/** Personnalité d'un bot. Toutes les valeurs vont de 0 à 1, sauf looseness (1 = standard). */
export interface BotStyle {
  name: string;
  avatar: string;
  level: BotLevel;
  /** en une phrase, pour le menu */
  blurb: string;
  /** multiplie la part de mains jouées (0,5 = très serré, 2 = joue presque tout) */
  looseness: number;
  /** penchant à miser et relancer plutôt que suivre */
  aggression: number;
  /** fréquence des bluffs */
  bluff: number;
  /** penchant à payer trop souvent */
  calling: number;
  /** qualité des décisions : lecture des ranges, cotes, position, tailles de mise */
  skill: number;
}

export const BOT_STYLES: BotStyle[] = [
  { name: 'Le Débutant', avatar: 'debutant', level: 'facile', blurb: 'joue trop de mains et paie beaucoup', looseness: 2, aggression: 0.2, bluff: 0.05, calling: 0.85, skill: 0.15 },
  { name: 'La Prudente', avatar: 'prudente', level: 'facile', blurb: 'très serrée, se couche facilement', looseness: 0.55, aggression: 0.25, bluff: 0.02, calling: 0.15, skill: 0.35 },
  { name: 'Le Fêtard', avatar: 'fetard', level: 'moyen', blurb: 'joue large et relance souvent', looseness: 1.7, aggression: 0.8, bluff: 0.25, calling: 0.5, skill: 0.45 },
  { name: 'La Calculatrice', avatar: 'calculatrice', level: 'moyen', blurb: 'serrée et agressive, respecte les cotes', looseness: 0.9, aggression: 0.65, bluff: 0.1, calling: 0.25, skill: 0.65 },
  { name: 'Le Cow-boy', avatar: 'cowboy', level: 'moyen', blurb: 'bluffeur, met la pression', looseness: 1.35, aggression: 0.75, bluff: 0.38, calling: 0.35, skill: 0.5 },
  { name: 'Le Requin', avatar: 'requin', level: 'difficile', blurb: 'solide, exploite les erreurs', looseness: 1.05, aggression: 0.7, bluff: 0.18, calling: 0.3, skill: 0.85 },
  { name: 'La Pro', avatar: 'pro', level: 'difficile', blurb: 'équilibrée, difficile à lire', looseness: 1, aggression: 0.65, bluff: 0.16, calling: 0.3, skill: 0.88 },
  { name: 'Le Mystère', avatar: 'mystere', level: 'expert', blurb: 'imprévisible, mélange ses actions', looseness: 1.15, aggression: 0.72, bluff: 0.22, calling: 0.3, skill: 0.95 },
  { name: 'Le Vétéran', avatar: 'veteran', level: 'expert', blurb: 'patient, choisit ses coups', looseness: 0.95, aggression: 0.62, bluff: 0.15, calling: 0.28, skill: 0.97 },
];

export const LEVEL_FR: Record<BotLevel | 'mix', string> = { facile: 'Facile', moyen: 'Moyen', difficile: 'Difficile', expert: 'Expert', mix: 'Mélangé' };

const POOLS: Record<BotLevel, string[]> = {
  facile: ['Le Débutant', 'La Prudente', 'Le Fêtard', 'Le Cow-boy', 'La Calculatrice', 'Le Requin', 'La Pro', 'Le Mystère', 'Le Vétéran'],
  moyen: ['Le Fêtard', 'La Calculatrice', 'Le Cow-boy', 'La Prudente', 'Le Requin', 'Le Débutant', 'La Pro', 'Le Mystère', 'Le Vétéran'],
  difficile: ['Le Requin', 'La Pro', 'La Calculatrice', 'Le Mystère', 'Le Cow-boy', 'Le Vétéran', 'Le Fêtard', 'La Prudente', 'Le Débutant'],
  expert: ['Le Mystère', 'Le Vétéran', 'Le Requin', 'La Pro', 'La Calculatrice', 'Le Cow-boy', 'Le Fêtard', 'La Prudente', 'Le Débutant'],
};

/** Choisit les adversaires selon le niveau demandé. */
export function pickBots(level: BotLevel | 'mix', count: number, seed = Date.now()): BotStyle[] {
  const rng = createRng(seed >>> 0);
  if (level === 'mix') {
    const all = [...BOT_STYLES];
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all.slice(0, count);
  }
  return POOLS[level].slice(0, count).map((n) => BOT_STYLES.find((b) => b.name === n)!);
}

export const styleFor = (name: string) => BOT_STYLES.find((b) => b.name === name);

/* ------------------------------------------------------------------ */

const clampTo = (to: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(to)));

function raiseAction(state: HandState, to: number): PlayerAction {
  const legal = legalActions(state)!;
  if (!legal.canBetOrRaise) return passive(state, true);
  const t = state.config.structure === 'FL' ? legal.minTo : clampTo(to, legal.minTo, legal.maxTo);
  return { type: legal.isBet ? 'bet' : 'raise', to: t };
}

function passive(state: HandState, wantCall: boolean): PlayerAction {
  const legal = legalActions(state)!;
  if (legal.canCheck) return { type: 'check' };
  return wantCall ? { type: 'call' } : { type: 'fold' };
}

/** Décision d'un bot selon sa personnalité. */
export function styledBot(state: HandState, style: BotStyle, rng: () => number = Math.random): PlayerAction {
  return state.street === 'preflop' ? preflop(state, style, rng) : postflop(state, style, rng);
}

function preflop(state: HandState, s: BotStyle, rng: () => number): PlayerAction {
  const legal = legalActions(state)!;
  const idx = state.toAct!;
  const me = state.players[idx];
  const bb = state.config.bigBlind;
  const live = state.players.filter((p) => !p.out);
  const headsUp = live.length === 2;
  const pos = positionOf(state, idx);
  const name = startingHandName(me.holeCards);
  // les joueurs peu doués évaluent mal leur main
  const t = Math.min(1, Math.max(0, topPercent(name) + (rng() - 0.5) * (1 - s.skill) * 0.35));
  const raises = state.log.filter((a) => a.street === 'preflop' && (a.type === 'raise' || a.type === 'bet'));
  const limpers = state.log.filter((a) => a.street === 'preflop' && a.type === 'call').length;
  const stackBB = (me.stack + me.bet) / bb;
  const toCall = legal.callAmount;
  const suitedPlayable = name.endsWith('s') && (name[0] === 'A' || 'KQJT98765'.includes(name[0]));

  // Tapis court (tournoi) : on pousse ou on se couche
  if (stackBB <= 12) {
    const pushTop = Math.min(0.7, (2.6 / stackBB) * s.looseness * (raises.length ? 0.45 : 1));
    if (t <= pushTop) return legal.canBetOrRaise ? raiseAction(state, legal.maxTo) : passive(state, true);
    if (toCall > 0 && toCall <= bb && t <= pushTop * 1.8) return { type: 'call' };
    return passive(state, false);
  }

  if (raises.length === 0) {
    if (pos === 'BB' && legal.canCheck) {
      const iso = 0.12 * s.looseness * (0.5 + s.aggression);
      return t <= iso && legal.canBetOrRaise ? raiseAction(state, (3 + limpers) * bb) : { type: 'check' };
    }
    const open = Math.min(0.9, openRange(pos, headsUp) * s.looseness * (limpers ? 0.75 : 1));
    if (t <= open) {
      // relance d'ouverture ; les débutants préfèrent souvent suivre
      if (rng() < 0.25 + s.aggression * 0.75 || t <= 0.05) {
        const size = s.skill > 0.6 ? (pos === 'SB' ? 3 : 2.5) : 2 + Math.floor(rng() * 3);
        return raiseAction(state, (size + limpers) * bb);
      }
      return passive(state, true);
    }
    if (s.calling > 0.5 && t <= Math.min(0.85, open * 1.6)) return passive(state, true); // limp
    return passive(state, false);
  }

  const last = raises[raises.length - 1];
  const raiserIdx = state.players.findIndex((p) => p.id === last.playerId);
  const potOdds = toCall / (potTotal(state) + toCall);
  const inPosition = pos === 'BTN' || pos === 'CO';

  if (raises.length === 1) {
    const r = openRange(positionOf(state, raiserIdx), headsUp) * (s.skill > 0.6 ? 1 : 1.2);
    const value = Math.max(0.03, r * 0.25) * (0.6 + s.aggression * 0.8);
    const call = Math.min(0.6, r * 0.6 * s.looseness * (1 + s.calling * 0.6) * (pos === 'BB' ? 1.6 : 1));
    if (t <= value) return raiseAction(state, state.currentBet * (inPosition ? 3 : 3.8));
    if (suitedPlayable && t <= r * 1.4 && rng() < s.bluff * 0.6) return raiseAction(state, state.currentBet * (inPosition ? 3 : 3.8));
    if (t <= call || (potOdds < 0.2 && t <= call * 1.5)) return { type: 'call' };
    return { type: 'fold' };
  }
  if (raises.length === 2) {
    const value = 0.025 * (0.7 + s.aggression * 0.6);
    if (t <= value) return raiseAction(state, stackBB < 40 ? legal.maxTo : state.currentBet * 2.3);
    if ((name === 'A5s' || name === 'A4s') && rng() < s.bluff * 0.5) return raiseAction(state, state.currentBet * 2.3);
    if (t <= 0.07 * s.looseness * (1 + s.calling * 0.5)) return { type: 'call' };
    return { type: 'fold' };
  }
  if (t <= 0.02) return raiseAction(state, legal.maxTo);
  if (t <= 0.035 + s.calling * 0.02) return { type: 'call' };
  return { type: 'fold' };
}

function postflop(state: HandState, s: BotStyle, rng: () => number): PlayerAction {
  const legal = legalActions(state)!;
  const idx = state.toAct!;
  const me = state.players[idx];
  const pot = potTotal(state);
  const opps = state.players.filter((p, i) => i !== idx && !p.folded && !p.out);
  const fair = 1 / (opps.length + 1);

  // Les bots doués estiment leur équité contre les ranges probables ; les autres regardent seulement leur main
  let e: number;
  if (s.skill >= 0.5) {
    const ranges = estimateRanges(state, me.id).map((r) => r.top);
    e = equityVsRanges(me.holeCards, state.board, ranges, Math.round(120 + s.skill * 220), Math.floor(rng() * 1e9));
  } else {
    const raw = postflopStrength(me.holeCards, state.board);
    e = Math.min(1, raw * (0.6 + 0.4 / opps.length) + 0.05);
  }
  e = Math.min(1, Math.max(0, e + (rng() - 0.5) * (1 - s.skill) * 0.25));

  const draws = state.board.length < 5 ? outs(me.holeCards as Card[], state.board).length : 0;
  const drawy = draws >= 8;
  const edge = e - fair;
  const lateStreet = state.board.length === 5;
  const sizing = (kind: 'value' | 'bluff') => {
    if (s.skill > 0.7) return pot * (lateStreet ? 0.7 : 0.55 + rng() * 0.2); // mêmes tailles en value et en bluff
    if (s.skill > 0.45) return pot * (kind === 'value' ? 0.66 : 0.5);
    return pot * (0.3 + rng() * 0.9);
  };

  if (legal.canCheck) {
    if (!legal.canBetOrRaise) return { type: 'check' };
    if (edge > 0.18 && rng() < 0.35 + s.aggression * 0.6) return raiseAction(state, sizing('value'));
    if (drawy && rng() < s.aggression * 0.55) return raiseAction(state, sizing('bluff'));
    if (edge < 0 && rng() < s.bluff * (opps.length === 1 ? 1 : 0.4)) return raiseAction(state, sizing('bluff'));
    return { type: 'check' };
  }

  const toCall = legal.callAmount;
  const need = toCall / (pot + toCall);
  const implied = drawy && !lateStreet && s.skill > 0.5 ? 0.07 : 0;
  // grosse main : relance
  if (legal.canBetOrRaise && e > need + 0.3 && edge > 0.2 && rng() < s.aggression * 0.7) {
    const to = state.currentBet * (2.6 + rng() * 0.6);
    return raiseAction(state, me.stack + me.bet < to * 1.6 ? legal.maxTo : to);
  }
  if (e + implied >= need - s.calling * 0.15) return { type: 'call' };
  if (legal.canBetOrRaise && opps.length === 1 && rng() < s.bluff * 0.15) return raiseAction(state, state.currentBet * 2.8);
  return { type: 'fold' };
}
