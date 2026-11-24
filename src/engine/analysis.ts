import type { Card } from './cards';
import { CATEGORY_NAMES_FR, evaluateBest } from './evaluator';
import { applyAction, legalActions, potTotal, startHand, type HandConfig, type HandState, type PlayerAction, type SeatInput, type Street } from './holdem';
import { outs, startingHandName } from './odds';
import { ADVICE_FR, equityVsRanges, estimateRanges, positionOf, POSITION_FR, preflopChart, type Advice } from './ranges';

/** De quoi rejouer une main à l'identique : sièges, réglages (avec la graine du paquet) et actions. */
export interface HandScript {
  seats: SeatInput[];
  config: HandConfig;
  actions: PlayerAction[];
}

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
    const name = startingHandName(hole);

    if (st.street === 'preflop') {
      const chart = preflopChart(st, st.toAct);
      if (!chart) return;
      const adv = chart.advise(name);
      const pos = POSITION_FR[positionOf(st, st.toAct)];
      const good = adv === kind || (adv === 'bluff' && (kind === 'raise' || kind === 'fold')) || (adv === 'call' && kind === 'check') || (adv === 'fold' && kind === 'check');
      if (good) {
        out.push({ street: 'preflop', played, grade: 'good', title: `${name} en ${pos} : ${ADVICE_FR[adv].toLowerCase()}, bien joué.`, detail: chart.title });
      } else if ((adv === 'raise' && kind === 'call') || (adv === 'call' && kind === 'raise')) {
        out.push({
          street: 'preflop',
          played,
          grade: 'ok',
          tag: adv === 'raise' ? 'pre-passive' : 'pre-ambitious',
          title: adv === 'raise' ? `${name} mérite une relance plutôt qu'un simple call.` : `Relancer avec ${name} est un peu ambitieux ici.`,
          detail: `${chart.title} Conseil : ${ADVICE_FR[adv].toLowerCase()}.`,
        });
      } else if (kind === 'fold') {
        out.push({ street: 'preflop', played, grade: 'mistake', tag: 'pre-tight', title: `Trop serré : ${name} se joue ici (${ADVICE_FR[adv].toLowerCase()}).`, detail: chart.detail });
      } else {
        out.push({ street: 'preflop', played, grade: 'mistake', tag: 'pre-loose', title: `Trop large : ${name} se couche ici depuis ${pos}.`, detail: chart.detail });
      }
      return;
    }

    // Après le flop : équité contre les mains probables des adversaires
    const ranges = estimateRanges(st, heroId).map((r) => r.top);
    if (!ranges.length) return;
    const e = equityVsRanges(hole, st.board, ranges, iterations, 17 + k);
    const fair = 1 / (ranges.length + 1);
    const pot = potTotal(st);
    const draws = st.board.length < 5 ? outs(hole, st.board).length : 0;
    const made = CATEGORY_NAMES_FR[evaluateBest([...hole, ...st.board]).category];
    const base = `Avec ${made.toLowerCase()}, tu avais environ ${pct(e)} de chances de gagner`;

    if (legal.callAmount > 0) {
      const need = legal.callAmount / (pot + legal.callAmount);
      const implied = draws >= 8 && st.board.length === 3 ? 0.08 : draws >= 8 ? 0.04 : 0;
      if (kind === 'fold') {
        if (e > need + 0.1) out.push({ street: st.street, played, grade: 'mistake', tag: 'fold-odds', title: 'Couché alors que la cote était bonne.', detail: `${base}, il en fallait ${pct(need)} pour suivre.`, equity: e, need });
        else out.push({ street: st.street, played, grade: 'good', title: 'Bon abandon.', detail: `${base}, il en fallait ${pct(need)}.`, equity: e, need });
      } else if (kind === 'call') {
        if (e + implied < need - 0.07) out.push({ street: st.street, played, grade: 'mistake', tag: 'call-no-odds', title: 'Suivi sans la cote.', detail: `${base}, il en fallait ${pct(need)}.${draws >= 8 ? ' Même avec ton tirage, le prix était trop élevé.' : ''}`, equity: e, need });
        else if (e > 0.7 && legal.canBetOrRaise) out.push({ street: st.street, played, grade: 'ok', tag: 'raise-missed', title: 'Main très forte : une relance rapportait sans doute plus.', detail: `${base}.`, equity: e, need });
        else out.push({ street: st.street, played, grade: 'good', title: 'Suivre était rentable.', detail: `${base}, il en fallait ${pct(need)}.`, equity: e, need });
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
    for (let i = before; i < out.length; i++) out[i].at = k;
  });
  return out;
}
