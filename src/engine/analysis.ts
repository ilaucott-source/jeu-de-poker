import type { Card } from './cards';
import { applyAction, legalActions, potTotal, startHand, type HandConfig, type HandState, type PlayerAction, type SeatInput, type Street } from './holdem';
import { startingHandName } from './odds';
import { ADVICE_FR, estimateRanges, positionOf, POSITION_FR, preflopChart, type Advice } from './ranges';
import { callPrice, effectiveBB, stageOf } from './tourney';
import { omahaLabel, omahaTop } from './omaha';
import { omahaPreflopChart } from './omahaAdvice';
import { equityFor, madeHandFr, outsFor, variantOf } from './variant';

/** De quoi rejouer une main à l'identique : sièges, réglages (avec la graine du paquet) et actions. */
export interface HandScript {
  seats: SeatInput[];
  config: HandConfig;
  actions: PlayerAction[];
}

/** À augmenter quand l'analyse change : les anciennes mains sont réanalysées à l'ouverture. */
export const ANALYSIS_VERSION = 2;

export type Grade = 'good' | 'ok' | 'mistake';

export interface Decision {
  street: Street;
  /** action jouée, en français */
  played: string;
  grade: Grade;
  /** type d'erreur, pour les regrouper dans les statistiques */
  tag?: string;
  /** index de l'action dans la main */
  at?: number;
  title: string;
  detail: string;
  equity?: number;
  need?: number;
  /** stade du tournoi au moment de la décision */
  stage?: string;
}

/** Actions d'une main terminée, dans l'ordre (hors blinds et antes). */
export function scriptActions(hand: HandState): PlayerAction[] {
  return hand.log
    .filter((a) => a.type !== 'post')
    .map((a) => (a.type === 'bet' || a.type === 'raise' ? { type: a.type, to: a.amount } : { type: a.type as 'fold' | 'check' | 'call' }));
}

/** Rejoue une main et renvoie l'état avant chaque action (et l'état final en dernier). */
export function replay(script: HandScript): HandState[] {
  let s = startHand(script.seats, script.config);
  const states = [s];
  for (const a of script.actions) {
    if (s.toAct === null) break;
    s = applyAction(s, a);
    states.push(s);
  }
  return states;
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

function playedFr(a: PlayerAction, isBet: boolean): string {
  switch (a.type) {
    case 'fold':
      return 'Couché';
    case 'check':
      return 'Parole';
    case 'call':
      return 'Suivi';
    default:
      return `${isBet ? 'Mise' : 'Relance'} à ${a.to}`;
  }
}

const kindOf = (a: PlayerAction): Advice | 'check' => (a.type === 'bet' || a.type === 'raise' ? 'raise' : a.type === 'call' ? 'call' : a.type === 'check' ? 'check' : 'fold');

/** Analyse les décisions du joueur sur une main. */
export function analyzeHand(script: HandScript, heroId: string, iterations = 500): Decision[] {
  const states = replay(script);
  const out: Decision[] = [];
  const step = (st: HandState, k: number) => {
    if (k >= script.actions.length || st.toAct === null) return;
    const me = st.players[st.toAct];
    if (me.id !== heroId) return;
    const a = script.actions[k];
    const legal = legalActions(st)!;
    const played = playedFr(a, legal.isBet);
    const kind = kindOf(a);
    const hole = me.holeCards as Card[];
    const variant = variantOf(st);
    const omaha = variant === 'omaha';
    const name = omaha ? omahaLabel(hole) : startingHandName(hole);

    if (st.street === 'preflop') {
      const chart = omaha ? omahaPreflopChart(st, st.toAct) : preflopChart(st, st.toAct);
      if (!chart) return;
      // face à un tapis (ou quand plus personne ne peut payer une relance), relancer est impossible ou inutile : seul compte payer ou se coucher
      const noRaise = !legal.canBetOrRaise;
      const adv0 = 'adviseTop' in chart ? chart.adviseTop(omahaTop(hole)) : chart.advise(name);
      const adv: Advice = noRaise && (adv0 === 'raise' || adv0 === 'bluff') ? (adv0 === 'raise' ? 'call' : 'fold') : adv0;
      const pos = POSITION_FR[positionOf(st, st.toAct)];
      const info = stageOf(st);
      const stage = info ? `${info.label} · ${Math.round(effectiveBB(st, st.toAct))} BB` : undefined;
      const good = adv === kind || (adv === 'bluff' && (kind === 'raise' || kind === 'fold')) || (adv === 'call' && kind === 'check') || (adv === 'fold' && kind === 'check');
      if (good) {
        out.push({ street: 'preflop', played, grade: 'good', title: `${name} en ${pos} : ${ADVICE_FR[adv].toLowerCase()}, bien joué.`, detail: chart.title, stage });
      } else if ((adv === 'raise' && kind === 'call') || (adv === 'call' && kind === 'raise')) {
        out.push({
          street: 'preflop',
          played,
          grade: 'ok',
          tag: adv === 'raise' ? 'pre-passive' : 'pre-ambitious',
          title: adv === 'raise' ? `${name} mérite une relance plutôt qu'un simple call.` : `Relancer avec ${name} est un peu ambitieux ici.`,
          detail: `${chart.title} Conseil : ${ADVICE_FR[adv].toLowerCase()}.`,
          stage,
        });
      } else if (kind === 'fold') {
        out.push({ street: 'preflop', played, grade: 'mistake', tag: 'pre-tight', title: `Trop serré : ${name} se joue ici (${ADVICE_FR[adv].toLowerCase()}).`, detail: chart.detail, stage });
      } else {
        out.push({ street: 'preflop', played, grade: 'mistake', tag: 'pre-loose', title: `Trop large : ${name} se couche ici depuis ${pos}.`, detail: chart.detail, stage });
      }
      return;
    }

    // Après le flop : équité contre les mains probables des adversaires
    const ranges = estimateRanges(st, heroId).map((r) => ({ top: r.top, post: r.post }));
    if (!ranges.length) return;
    const info = stageOf(st);
    const e = equityFor(variant, hole, st.board, ranges, iterations, 17 + k);
    const fair = 1 / (ranges.length + 1);
    const pot = potTotal(st);
    const draws = st.board.length < 5 ? outsFor(variant, hole, st.board).length : 0;
    const made = madeHandFr(variant, hole, st.board);
    const base = `Avec ${made.toLowerCase()}, tu avais environ ${pct(e)} de chances de gagner`;

    if (legal.callAmount > 0) {
      const chipNeed = legal.callAmount / (pot + legal.callAmount);
      let need = chipNeed;
      let icmNote = '';
      const lastBet = [...st.log].reverse().find((x) => x.street === st.street && (x.type === 'bet' || x.type === 'raise'));
      if (info && info.pressure > 0 && lastBet && legal.callAmount >= me.stack * 0.4) {
        const price = callPrice(st, st.toAct, st.players.findIndex((p) => p.id === lastBet.playerId));
        if (price.icm > need + 0.015) icmNote = ` ${info.label} : avec l'ICM il fallait ${pct(price.icm)} et non ${pct(need)}, car perdre ce tapis coûte plus que le doubler ne rapporte.`;
        need = Math.max(need, price.icm);
      }
      const implied = draws >= 8 && st.board.length === 3 ? 0.08 : draws >= 8 ? 0.04 : 0;
      if (kind === 'fold') {
        if (e > need + 0.1) out.push({ street: st.street, played, grade: 'mistake', tag: 'fold-odds', title: 'Couché alors que la cote était bonne.', detail: `${base}, il en fallait ${pct(need)} pour suivre.${icmNote}`, equity: e, need });
        else out.push({ street: st.street, played, grade: 'good', title: 'Bon abandon.', detail: `${base}, il en fallait ${pct(need)}.${icmNote}`, equity: e, need });
      } else if (kind === 'call') {
        if (icmNote && e + implied < need - 0.03 && e + implied >= chipNeed - 0.03)
          out.push({ street: st.street, played, grade: 'mistake', tag: 'icm-call', title: 'Call rentable en jetons, mais trop risqué en tournoi.', detail: `${base}.${icmNote}`, equity: e, need });
        else if (e + implied < need - 0.07) out.push({ street: st.street, played, grade: 'mistake', tag: 'call-no-odds', title: 'Suivi sans la cote.', detail: `${base}, il en fallait ${pct(need)}.${draws >= 8 ? ' Même avec ton tirage, le prix était trop élevé.' : ''}${icmNote}`, equity: e, need });
        else if (e > 0.7 && legal.canBetOrRaise) out.push({ street: st.street, played, grade: 'ok', tag: 'raise-missed', title: 'Main très forte : une relance rapportait sans doute plus.', detail: `${base}.`, equity: e, need });
        else out.push({ street: st.street, played, grade: 'good', title: 'Suivre était rentable.', detail: `${base}, il en fallait ${pct(need)}.${icmNote}`, equity: e, need });
      } else {
        if (e >= 0.55) out.push({ street: st.street, played, grade: 'good', title: 'Relance de valeur.', detail: `${base}.`, equity: e });
        else if (draws >= 8) out.push({ street: st.street, played, grade: 'good', title: 'Semi-bluff avec un tirage.', detail: `${base}, avec ${draws} outs pour t'améliorer.`, equity: e });
        else out.push({ street: st.street, played, grade: 'ok', tag: 'bluff-raise', title: 'Relance en bluff.', detail: `${base}. Ça marche si l'adversaire se couche souvent ; contre un joueur qui paie tout, évite.`, equity: e });
      }
      return;
    }

    if (kind === 'check') {
      if (e > fair + 0.25 && e > 0.6) out.push({ street: st.street, played, grade: 'ok', tag: 'missed-value', title: 'Mise de valeur manquée.', detail: `${base} : en misant, tu te faisais payer par des mains moins fortes.`, equity: e });
      else out.push({ street: st.street, played, grade: 'good', title: 'Parole raisonnable.', detail: `${base}.`, equity: e });
    } else {
      const size = (a as { to: number }).to / Math.max(1, pot);
      if (e >= 0.55) out.push({ street: st.street, played, grade: size < 0.25 && e > 0.75 ? 'ok' : 'good', title: size < 0.25 && e > 0.75 ? 'Bonne mise, mais un peu petite pour une main aussi forte.' : 'Mise de valeur.', detail: `${base}. Mise de ${pct(size)} du pot.`, equity: e });
      else if (draws >= 8) out.push({ street: st.street, played, grade: 'good', title: 'Semi-bluff avec un tirage.', detail: `${base}, avec ${draws} outs.`, equity: e });
      else if (e < fair - 0.1 && ranges.length >= 2) out.push({ street: st.street, played, grade: 'mistake', tag: 'multi-bluff', title: 'Bluff contre plusieurs adversaires.', detail: `${base}. Un bluff réussit rarement quand plusieurs joueurs peuvent payer.`, equity: e });
      else out.push({ street: st.street, played, grade: 'ok', tag: 'weak-bet', title: 'Mise sans grosse main.', detail: `${base}. Acceptable en bluff contre un seul adversaire prudent.`, equity: e });
    }
  };
  states.forEach((st, k) => {
    const before = out.length;
    step(st, k);
    const info = stageOf(st);
    for (let i = before; i < out.length; i++) {
      out[i].at = k;
      if (info && !out[i].stage && st.toAct !== null) out[i].stage = `${info.label} · ${Math.round(effectiveBB(st, st.toAct))} BB`;
    }
  });
  return out;
}
