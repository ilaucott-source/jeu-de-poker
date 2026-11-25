import { createRng, type Card } from './cards';
import { legalActions, potTotal, type HandState, type PlayerAction } from './holdem';
import { startingHandName } from './odds';
import { estimateRanges, openRange, positionOf, preflopContext, topPercent, type RangeSpec } from './ranges';
import { eqVsTops } from './preflopTable';
import { callPrice, pushRange } from './tourney';
import { omahaTop } from './omaha';
import { omahaPreflopChart } from './omahaAdvice';
import { classFor, equityFor, outsFor, variantOf } from './variant';
import { draw27PreChart, drawsLeft, equity27For, opponents27 } from './draw27';
import { planDraw, top27 } from './lowball';

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
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function raiseAction(state: HandState, to: number): PlayerAction {
  const legal = legalActions(state)!;
  if (!legal.canBetOrRaise) return passive(state, true);
  const t = state.config.structure === 'FL' ? legal.minTo : clampTo(to, legal.minTo, legal.maxTo);
  return { type: legal.isBet ? 'bet' : 'raise', to: t };
}

/** Mise ou relance ; si elle engagerait presque tout le tapis, on pousse directement. */
function raiseOrShove(state: HandState, to: number): PlayerAction {
  const legal = legalActions(state)!;
  const me = state.players[state.toAct!];
  if (legal.canBetOrRaise && state.config.structure !== 'FL' && to >= (me.stack + me.bet) * 0.6) return raiseAction(state, legal.maxTo);
  return raiseAction(state, to);
}

function passive(state: HandState, wantCall: boolean): PlayerAction {
  const legal = legalActions(state)!;
  if (legal.canCheck) return { type: 'check' };
  return wantCall ? { type: 'call' } : { type: 'fold' };
}

/**
 * Décision d'un bot selon sa personnalité.
 * Tous les bots raisonnent en probabilités (équité contre les mains probables, cote du pot,
 * tapis en BB, ICM en tournoi) ; leur profil change leur range et leurs penchants,
 * et les moins doués font des erreurs plausibles (lecture approximative, un peu trop de calls,
 * ICM ignoré en partie, top paire surestimée) mais plus d'absurdités.
 */
export function styledBot(state: HandState, style: BotStyle, rng: () => number = Math.random): PlayerAction {
  if (state.config.variant === 'draw27') {
    if (state.drawPending?.length) return botDraw(state, style, rng);
    if (state.street === 'preflop') {
      const me = state.players[state.toAct!];
      return chartPreflop(state, style, rng, draw27PreChart(state, state.toAct!), top27(me.holeCards));
    }
    return draw27Bet(state, style, rng);
  }
  if (state.street === 'preflop') {
    if (state.config.variant === 'omaha') {
      const me = state.players[state.toAct!];
      return chartPreflop(state, style, rng, omahaPreflopChart(state, state.toAct!), omahaTop(me.holeCards));
    }
    return preflop(state, style, rng);
  }
  return postflop(state, style, rng);
}

/** Relance « au pot » (le maximum en Pot Limit), limitée à ce qui est permis. */
function potRaise(state: HandState, frac = 1): PlayerAction {
  const legal = legalActions(state)!;
  const pot = potTotal(state) + legal.callAmount;
  return raiseOrShove(state, state.currentBet + pot * frac);
}

/**
 * Omaha et 2-7 avant le premier tour : même raisonnement qu'au Hold'em (position, ranges, cote, ICM),
 * à partir d'un conseil qui situe la main en « top X % ».
 */
function chartPreflop(state: HandState, s: BotStyle, rng: () => number, chart: { adviseTop: (t: number) => string } | null, top: number): PlayerAction {
  const legal = legalActions(state)!;
  const me = state.players[state.toAct!];
  if (!chart) return passive(state, false);
  // les moins doués situent mal leur main, et les joueurs larges se croient plus forts qu'ils ne sont
  const raw = clamp01(top + (rng() - 0.5) * (1 - s.skill) * 0.2);
  const loose = Math.pow(s.looseness, 0.8);
  const t = raw / loose;
  const adv = chart.adviseTop(t);
  const raises = state.log.filter((a) => a.street === 'preflop' && (a.type === 'raise' || a.type === 'bet')).length;
  const big = legal.callAmount >= me.stack * 0.4;
  if (adv === 'raise') {
    if (!legal.canBetOrRaise) return passive(state, true);
    // les joueurs passifs se contentent parfois de suivre
    if (rng() > 0.35 + s.aggression * 0.65 && raw > 0.02) return passive(state, true);
    const frac = s.skill > 0.6 ? 1 : 0.6 + rng() * 0.4;
    return potRaise(state, frac);
  }
  if (adv === 'call') {
    if (legal.canCheck) {
      // bluff de position : parfois une relance avec une main jouable
      if (legal.canBetOrRaise && raises === 0 && rng() < s.bluff * 0.15) return potRaise(state, 0.8);
      return { type: 'check' };
    }
    if (legal.canBetOrRaise && !big && raises === 1 && raw <= 0.2 && rng() < s.bluff * 0.3) return potRaise(state);
    return { type: 'call' };
  }
  // main à jeter : les « payeurs » suivent quand même parfois une petite mise
  if (legal.canCheck) return { type: 'check' };
  const cheap = legal.callAmount <= state.config.bigBlind * (raises ? 4 : 1);
  if (cheap && !big && t <= 0.65 && rng() < s.calling * 0.45) return { type: 'call' };
  return { type: 'fold' };
}

/** Joueurs qui ont mis de l'argent dans le pot préflop (relance ou call) : ce sont eux qu'on affronte. */
function involved(state: HandState, meId: string) {
  return estimateRanges(state, meId).filter((r) => state.log.some((a) => a.street === 'preflop' && a.playerId === r.id && (a.type === 'call' || a.type === 'raise' || a.type === 'bet')));
}

function preflop(state: HandState, s: BotStyle, rng: () => number): PlayerAction {
  const legal = legalActions(state)!;
  const idx = state.toAct!;
  const me = state.players[idx];
  const bb = state.config.bigBlind;
  const headsUp = state.players.filter((p) => !p.out).length === 2;
  const pos = positionOf(state, idx);
  const name = startingHandName(me.holeCards);
  const ctx = preflopContext(state, idx);
  const nl = state.config.structure !== 'FL';
  // les joueurs peu doués évaluent mal leur main, mais sans confondre 72o et AK
  const t = clamp01(topPercent(name) + (rng() - 0.5) * (1 - s.skill) * 0.16);
  const loose = Math.pow(s.looseness, 0.8);
  const raises = state.log.filter((a) => a.street === 'preflop' && (a.type === 'raise' || a.type === 'bet'));
  const limpers = state.log.filter((a) => a.street === 'preflop' && a.type === 'call').length;
  const toCall = legal.callAmount;
  const pressure = ctx.info?.pressure ?? 0;

  // Gros call : tapis adverse ou relance qui engage une grosse part du tapis
  const last = raises[raises.length - 1];
  if (last && nl && (last.allIn || toCall >= me.stack * 0.4)) {
    const raiserIdx = state.players.findIndex((p) => p.id === last.playerId);
    // les joueurs qui paient trop croient qu'on bluffe plus souvent
    const ws = involved(state, me.id).map((r) => Math.min(1, r.top * (1 + s.calling * 0.6 * (1 - s.skill))));
    const e = eqVsTops(name, ws.length ? ws : [0.1]) + (rng() - 0.5) * (1 - s.skill) * 0.1;
    const price = callPrice(state, idx, raiserIdx);
    // les moins doués ne tiennent compte de l'ICM qu'à moitié : erreur classique à la bulle
    const need = price.chip + (price.icm - price.chip) * (0.4 + 0.6 * s.skill);
    if (e >= need - s.calling * 0.04) {
      if (legal.canBetOrRaise && !last.allIn && e > 0.62) return raiseAction(state, legal.maxTo);
      return { type: 'call' };
    }
    return passive(state, false);
  }

  if (raises.length === 0) {
    if (pos === 'BB' && legal.canCheck) {
      const iso = (nl && ctx.effBB <= 12 ? 0.25 : 0.12) * loose * (0.5 + s.aggression);
      if (t <= iso && legal.canBetOrRaise) return nl && ctx.effBB <= 12 ? raiseAction(state, legal.maxTo) : raiseOrShove(state, (3 + limpers) * bb);
      return { type: 'check' };
    }
    if (nl && ctx.effBB <= 12) {
      // Tapis ou se coucher (ranges de Nash approchées), ajustées au profil et à la bulle
      const push = Math.min(1, pushRange(pos, ctx.effBB, headsUp) * ctx.tighten * (0.8 + 0.2 * loose) * (limpers ? 0.7 : 1) * (1 + (rng() - 0.5) * (1 - s.skill) * 0.4));
      if (t <= push) return raiseAction(state, legal.maxTo);
      // erreur de débutant : suivre la blind au lieu de pousser
      if (s.skill < 0.4 && t <= push * 1.3 && toCall <= bb && rng() < 0.4 - s.skill) return { type: 'call' };
      return passive(state, false);
    }
    let open = openRange(pos, headsUp) * loose * (limpers ? 0.75 : 1) * ctx.tighten;
    if (ctx.info && ctx.effBB <= 25 && ['CO', 'BTN', 'SB'].includes(pos)) open *= 1 + 0.15 * s.skill; // les bons joueurs volent les blinds
    open = Math.min(0.85, open);
    if (t <= open) {
      // relance d'ouverture ; les joueurs passifs suivent parfois
      if (rng() < 0.3 + s.aggression * 0.7 || t <= 0.05) {
        const size = ctx.effBB <= 25 && s.skill > 0.5 ? 2.2 : s.skill > 0.6 ? (pos === 'SB' ? 3 : 2.5) : 2 + Math.floor(rng() * 3);
        return raiseOrShove(state, (size + limpers) * bb);
      }
      return passive(state, true);
    }
    if (s.calling > 0.5 && ctx.effBB > 20 && t <= Math.min(0.75, open * 1.5)) return passive(state, true); // limp
    return passive(state, false);
  }

  const raiserIdx = state.players.findIndex((p) => p.id === last.playerId);
  const potOdds = toCall / (potTotal(state) + toCall);
  const inPosition = pos === 'BTN' || pos === 'CO';
  // plus la relance est grosse, plus il faut une bonne main pour suivre
  const sizeFactor = Math.max(0.35, Math.min(1, Math.pow((3 * bb) / Math.max(bb, state.currentBet), 0.6)));

  if (raises.length === 1) {
    const r = openRange(positionOf(state, raiserIdx), headsUp) * (s.skill > 0.6 ? 1 : 1.2);
    if (nl && ctx.effBB <= 25) {
      // tapis court face à une ouverture : relance à tapis ou abandon, rarement un call
      const shove = Math.min(0.35, Math.max(0.05, r * 0.45 * Math.pow(20 / ctx.effBB, 0.5)) * ctx.tighten * Math.pow(loose, 0.5) * (0.8 + s.aggression * 0.4));
      if (t <= shove) return raiseAction(state, legal.maxTo);
      if (ctx.effBB > 18 && t <= shove * 1.5 * (0.7 + s.calling * 0.6) && toCall <= 3 * bb) return { type: 'call' };
      return { type: 'fold' };
    }
    const value = Math.max(0.03, r * 0.25) * (0.6 + s.aggression * 0.8);
    const call = Math.min(0.5, r * 0.6 * loose * (1 + s.calling * 0.5) * (pos === 'BB' ? 1.6 : 1)) * sizeFactor * (1 - 0.35 * pressure);
    if (t <= value) return raiseOrShove(state, state.currentBet * (inPosition ? 3 : 3.8));
    const suitedPlayable = name.endsWith('s') && (name[0] === 'A' || 'KQJT98765'.includes(name[0]));
    if (suitedPlayable && t <= r * 1.3 && rng() < s.bluff * 0.35 * (1 - pressure * 0.5)) return raiseOrShove(state, state.currentBet * (inPosition ? 3 : 3.8));
    if (t <= call || (potOdds < 0.2 && t <= call * 1.4)) return { type: 'call' };
    return { type: 'fold' };
  }
  if (raises.length === 2) {
    const value = 0.025 * (0.7 + s.aggression * 0.6);
    if (t <= value) return raiseOrShove(state, ctx.effBB < 40 ? legal.maxTo : state.currentBet * 2.3);
    if ((name === 'A5s' || name === 'A4s') && rng() < s.bluff * 0.4 && ctx.effBB > 40) return raiseAction(state, state.currentBet * 2.3);
    if (t <= 0.07 * Math.pow(loose, 0.5) * (1 + s.calling * 0.4) * sizeFactor) return { type: 'call' };
    return { type: 'fold' };
  }
  if (t <= 0.02) return raiseAction(state, legal.maxTo);
  if (t <= 0.035 + s.calling * 0.015) return { type: 'call' };
  return { type: 'fold' };
}

function postflop(state: HandState, s: BotStyle, rng: () => number): PlayerAction {
  const legal = legalActions(state)!;
  const idx = state.toAct!;
  const me = state.players[idx];
  const pot = potTotal(state);
  const ranges = estimateRanges(state, me.id);
  const opps = ranges.length;
  const fair = 1 / (opps + 1);
  const hole = me.holeCards as Card[];
  const variant = variantOf(state);

  // Tous les bots estiment leur équité contre les mains probables ; les moins doués ne lisent que l'action préflop
  const specs: RangeSpec[] = ranges.map((r) => (s.skill >= 0.45 ? { top: r.top, post: r.post } : Math.min(1, r.top * 1.3)));
  let e = equityFor(variant, hole, state.board, specs, Math.round(110 + s.skill * 220), Math.floor(rng() * 1e9));
  const cls = classFor(variant, hole, state.board);
  if (cls === 3) e += (1 - s.skill) * 0.06; // erreur plausible : on surestime sa top paire
  e = clamp01(e + (rng() - 0.5) * (1 - s.skill) * 0.12);

  const draws = state.board.length < 5 ? outsFor(variant, hole, state.board).length : 0;
  const drawy = draws >= 8;
  const edge = e - fair;
  const lateStreet = state.board.length === 5;
  const sizing = (kind: 'value' | 'bluff') => {
    if (s.skill > 0.7) return pot * (lateStreet ? 0.7 : 0.55 + rng() * 0.2); // mêmes tailles en value et en bluff
    if (s.skill > 0.45) return pot * (kind === 'value' ? 0.66 : 0.5);
    return pot * (0.4 + rng() * 0.5);
  };

  if (legal.canCheck) {
    if (!legal.canBetOrRaise) return { type: 'check' };
    if (e > Math.max(0.55, fair + 0.18) && rng() < 0.4 + s.aggression * 0.55) return raiseOrShove(state, sizing('value'));
    if (drawy && opps <= 2 && rng() < s.aggression * 0.5) return raiseOrShove(state, sizing('bluff'));
    // bluff : surtout en tête-à-tête, avec une main qui ne gagne pas à l'abattage
    const bluffRate = s.bluff * (opps === 1 ? 1 : 0.25) * (lateStreet ? 0.7 : 1);
    if (edge < 0 && cls <= 1 && rng() < bluffRate) return raiseOrShove(state, sizing('bluff'));
    return { type: 'check' };
  }

  const toCall = legal.callAmount;
  let need = toCall / (pot + toCall);
  const big = toCall >= me.stack * 0.4;
  const last = [...state.log].reverse().find((a) => a.street === state.street && (a.type === 'bet' || a.type === 'raise'));
  if (big && last && state.config.tourney) {
    const vIdx = state.players.findIndex((p) => p.id === last.playerId);
    const price = callPrice(state, idx, vIdx);
    need = price.chip + (price.icm - price.chip) * (0.4 + 0.6 * s.skill);
  }
  const implied = drawy && !lateStreet && !big && s.skill > 0.4 ? 0.06 : 0;
  // les « payeurs » suivent un peu trop… mais beaucoup moins quand c'est tout leur tapis
  const leak = s.calling * 0.1 * (1 - Math.min(1, toCall / Math.max(1, me.stack)) * 0.75);

  if (legal.canBetOrRaise && e > 0.65 && e > need + 0.25 && rng() < s.aggression * 0.7) {
    return raiseOrShove(state, state.currentBet * (2.5 + rng() * 0.5));
  }
  if (e + implied >= need - leak) return { type: 'call' };
  if (legal.canBetOrRaise && !lateStreet && opps === 1 && (drawy || cls === 1) && !big && rng() < s.bluff * 0.25) return raiseOrShove(state, state.currentBet * 2.8);
  return { type: 'fold' };
}

/* ------------------------------ 2-7 Triple Draw ------------------------------ */

/** Cartes à changer : la stratégie de base, que les joueurs faibles appliquent mal (ils gardent des cartes trop hautes). */
function botDraw(state: HandState, s: BotStyle, rng: () => number): PlayerAction {
  const me = state.players[state.toAct!];
  const left = drawsLeft(state);
  const loose = s.skill < 0.5 && rng() < 0.5 - s.skill ? 1 : 0;
  let discard = planDraw(me.holeCards, left, loose);
  // bluff « servi » : au dernier tirage, face à un seul adversaire qui tire encore, les bluffeurs gardent parfois tout
  const opps = opponents27(state, me.id);
  if (left === 1 && discard.length >= 2 && opps.length === 1 && rng() < s.bluff * 0.25 * s.skill) discard = [];
  return { type: 'draw', discard };
}

/** Mises après un tirage (Limit) : équité contre les mains compatibles avec les tirages adverses, comparée au prix. */
function draw27Bet(state: HandState, s: BotStyle, rng: () => number): PlayerAction {
  const legal = legalActions(state)!;
  const me = state.players[state.toAct!];
  const pot = potTotal(state);
  const opps = opponents27(state, me.id);
  const fair = 1 / (opps.length + 1);
  let e = equity27For(state, me.id, Math.round(80 + s.skill * 160), Math.floor(rng() * 1e9));
  e = clamp01(e + (rng() - 0.5) * (1 - s.skill) * 0.12);
  const left = drawsLeft(state);
  const pat = state.log.filter((a) => a.playerId === me.id && a.type === 'draw').slice(-1)[0]?.amount === 0;
  if (legal.canCheck) {
    if (!legal.canBetOrRaise) return { type: 'check' };
    if (e > Math.max(0.5, fair + 0.15) && rng() < 0.45 + s.aggression * 0.5) return raiseAction(state, legal.minTo);
    // pression d'un joueur servi, ou bluff contre un seul adversaire qui tire encore
    if (opps.length === 1 && (pat || left > 0) && rng() < s.bluff * (pat ? 0.8 : 0.4)) return raiseAction(state, legal.minTo);
    return { type: 'check' };
  }
  const toCall = legal.callAmount;
  const need = toCall / (pot + toCall);
  const leak = s.calling * 0.08;
  if (legal.canBetOrRaise && e > Math.max(0.62, need + 0.25) && rng() < s.aggression * 0.75) return raiseAction(state, legal.minTo);
  if (e >= need - leak) return { type: 'call' };
  return { type: 'fold' };
}
