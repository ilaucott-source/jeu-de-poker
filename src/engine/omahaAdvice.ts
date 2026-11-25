import type { Card } from './cards';
import type { HandState } from './holdem';
import { omahaFeatures, omahaPreflopEquity, omahaTop } from './omaha';
import { estimateRanges, openRangeFor, positionOf, POSITION_FR, preflopContext, type Advice, type PreflopContext } from './ranges';
import { callPrice } from './tourney';
import { stageTip } from './tips';

/** Conseil préflop à l'Omaha : comme au Hold'em, mais on situe la main en « top X % » des mains à 4 cartes. */
export interface OmahaChart {
  title: string;
  detail: string;
  /** action conseillée pour une main située dans le top `t` (0 à 1) */
  adviseTop: (t: number) => Advice;
  legend: { a: Advice; label: string }[];
}

const withTip = (detail: string, ctx: PreflopContext) => (ctx.info ? `${detail} ${ctx.info.label} : ${stageTip(ctx.info)}` : detail);
const p = (x: number) => `${Math.round(x * 100)} %`;

export function omahaPreflopChart(hand: HandState, heroIndex: number): OmahaChart | null {
  if (hand.street !== 'preflop') return null;
  const headsUp = hand.players.filter((x) => !x.out).length === 2;
  const pos = positionOf(hand, heroIndex);
  const posFr = POSITION_FR[pos];
  const raises = hand.log.filter((a) => a.street === 'preflop' && (a.type === 'raise' || a.type === 'bet'));
  const limps = hand.log.filter((a) => a.street === 'preflop' && a.type === 'call').length;
  const ctx = preflopContext(hand, heroIndex);
  const me = hand.players[heroIndex];
  const pressure = ctx.info?.pressure ?? 0;

  if (raises.length === 0) {
    if (pos === 'BB') {
      return {
        title: 'Grosse blind, personne n’a relancé',
        detail: withTip('Relance tes toutes meilleures mains (top 8 %), sinon parole gratuite : tu vois le flop sans payer.', ctx),
        adviseTop: (t) => (t <= 0.08 ? 'raise' : 'call'),
        legend: [
          { a: 'raise', label: 'Relancer · top 8 %' },
          { a: 'call', label: 'Parole' },
        ],
      };
    }
    const open = Math.min(0.85, openRangeFor(true, pos, headsUp) * (limps ? 0.8 : 1) * ctx.tighten);
    return {
      title: limps ? `Des joueurs ont suivi · ${posFr}` : `Ouverture à l’Omaha · ${posFr}`,
      detail: withTip(
        `À l’Omaha, entre en relançant (au pot en Pot Limit) avec le top ${p(open)} ; couche le reste. Les meilleures mains sont connectées et suitées, idéalement à l’As : elles visent les quintes et couleurs maximum.`,
        ctx,
      ),
      adviseTop: (t) => (t <= open ? 'raise' : 'fold'),
      legend: [
        { a: 'raise', label: `Relancer · top ${p(open)}` },
        { a: 'fold', label: 'Se coucher' },
      ],
    };
  }

  const last = raises[raises.length - 1];
  const raiserIdx = hand.players.findIndex((x) => x.id === last.playerId);
  const raiser = hand.players[raiserIdx];
  const toCall = Math.min(hand.currentBet - me.bet, me.stack);
  if (last.allIn || toCall >= me.stack * 0.4) {
    const opp = estimateRanges(hand, me.id).filter((r) => r.id === raiser.id || hand.log.some((a) => a.street === 'preflop' && a.playerId === r.id && a.type === 'call'));
    const ws = opp.map((r) => r.top);
    const price = callPrice(hand, heroIndex, raiserIdx);
    const need = price.icm;
    const icmNote = price.icm > price.chip + 0.015 ? ` ICM : il te faut ${p(price.icm)} au lieu de ${p(price.chip)} en jetons.` : '';
    return {
      title: `${raiser.name} ${last.allIn ? 'est à tapis' : 'a fait une grosse relance'} : payer ou se coucher ?`,
      detail: withTip(`À l’Omaha, les chances sont serrées avant le flop (rarement plus de 65 % contre une seule main). Il te faut ${p(need)} pour payer.${icmNote}`, ctx),
      adviseTop: (t) => (omahaPreflopEquity(t, ws) >= need ? 'call' : 'fold'),
      legend: [
        { a: 'call', label: `Payer · équité ≥ ${p(need)}` },
        { a: 'fold', label: 'Se coucher' },
      ],
    };
  }
  if (raises.length === 1) {
    const r = openRangeFor(true, positionOf(hand, raiserIdx), headsUp);
    const value = Math.max(0.03, r * 0.18);
    const call = Math.min(0.45, r * (heroIndex === hand.bbIndex ? 1.1 : 0.75)) * (1 - 0.35 * pressure);
    return {
      title: `${raiser.name} a relancé (${POSITION_FR[positionOf(hand, raiserIdx)]}) : sur-relancer, suivre ou passer ?`,
      detail: withTip(`On lui prête le top ${p(r)}. Sur-relance au pot avec le top ${p(value)} (surtout les paires d’As bien accompagnées), suis jusqu’au top ${p(call)}, en particulier les mains connectées et suitées qui jouent bien après le flop.`, ctx),
      adviseTop: (t) => (t <= value ? 'raise' : t <= call ? 'call' : 'fold'),
      legend: [
        { a: 'raise', label: `Sur-relancer · top ${p(value)}` },
        { a: 'call', label: 'Suivre' },
        { a: 'fold', label: 'Se coucher' },
      ],
    };
  }
  const value = raises.length === 2 ? 0.02 : 0.012;
  const call = raises.length === 2 ? 0.07 : 0.03;
  return {
    title: `${raiser.name} a sur-relancé (${raises.length + 1}-bet)`,
    detail: withTip('Une sur-relance à l’Omaha, c’est très souvent une paire d’As. Ne continue qu’avec les meilleures mains, et relance encore surtout avec des As bien accompagnés.', ctx),
    adviseTop: (t) => (t <= value ? 'raise' : t <= call ? 'call' : 'fold'),
    legend: [
      { a: 'raise', label: `Relancer · top ${p(value)}` },
      { a: 'call', label: 'Suivre' },
      { a: 'fold', label: 'Se coucher' },
    ],
  };
}

/** Résumé d'une main d'Omaha : « top 12 % · double suitée, très connectée ». */
export function omahaSummary(hole: Card[]): { top: number; features: string[] } {
  return { top: omahaTop(hole), features: omahaFeatures(hole) };
}
