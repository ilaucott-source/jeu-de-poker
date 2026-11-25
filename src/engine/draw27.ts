import { type Card, createRng, fullDeck } from './cards';
import type { HandState } from './holdem';
import { planDraw, score27, top27 } from './lowball';
import { openRange, positionOf, POSITION_FR, preflopContext, type Advice, type PreflopContext } from './ranges';
import { stageTip } from './tips';
import type { OmahaChart } from './omahaAdvice';

/** Ce qu'on sait d'un adversaire au 2-7 : combien de cartes il a changé à chaque tirage, et son action avant le premier. */
export interface Opp27 {
  id: string;
  name: string;
  /** cartes changées à chaque tirage déjà fait */
  draws: number[];
  /** avant le premier tirage : 0 a suivi la blind (ou rien), 1 a suivi une relance, 2 a relancé */
  pre: 0 | 1 | 2;
  /** a misé ou relancé depuis le dernier tirage */
  aggressive: boolean;
}

/** Tirages restants avant l'abattage, celui en cours compris si on est en train de changer ses cartes. */
export function drawsLeft(state: HandState): number {
  const base = { preflop: 3, flop: 2, turn: 1, river: 0, showdown: 0, complete: 0 }[state.street];
  return state.drawPending?.length ? base + 1 : base;
}

export function opponents27(state: HandState, heroId: string): Opp27[] {
  const res: Opp27[] = [];
  for (const p of state.players) {
    if (p.id === heroId || p.out || p.folded) continue;
    const mine = state.log.filter((a) => a.playerId === p.id);
    const draws = mine.filter((a) => a.type === 'draw').map((a) => a.amount);
    let pre: 0 | 1 | 2 = 0;
    let raisesBefore = 0;
    for (const a of state.log.filter((x) => x.street === 'preflop' && x.type !== 'post')) {
      if (a.playerId === p.id) {
        if (a.type === 'raise' || a.type === 'bet') pre = 2;
        else if (a.type === 'call' && raisesBefore > 0 && pre < 1) pre = 1;
      }
      if (a.type === 'raise' || a.type === 'bet') raisesBefore++;
    }
    const lastDraw = state.log.map((a, i) => ({ a, i })).filter(({ a }) => a.type === 'draw').pop()?.i ?? -1;
    const aggressive = state.street !== 'preflop' && mine.some((a) => (a.type === 'bet' || a.type === 'raise') && state.log.indexOf(a) > lastDraw);
    res.push({ id: p.id, name: p.name, draws, pre, aggressive });
  }
  return res;
}

const TOTAL_DRAWS = 3;

/**
 * Équité au 2-7 par simulation : on tire des mains d'adversaires compatibles avec ce qu'ils ont fait
 * (nombre de cartes changées, relance avant le tirage), puis chacun termine ses tirages avec une stratégie solide.
 * `heroDrawsDone` = tirages déjà faits par le héros ; `heroDiscardNow` = son choix pour le tirage en cours (sinon la stratégie).
 */
export function equity27(
  hero: Card[],
  dead: Card[],
  heroDrawsDone: number,
  opps: Opp27[],
  iterations = 300,
  seed = 7,
  heroDiscardNow?: number[],
): number {
  const rng = createRng(seed);
  const deck = fullDeck();
  let eq = 0;
  const draw = (used: Set<string>) => {
    for (;;) {
      const c = deck[Math.floor(rng() * 52)];
      if (!used.has(c)) {
        used.add(c);
        return c;
      }
    }
  };
  // `used` = cartes en main de quelqu'un (ou connues mortes) : une carte jetée peut être retirée par un autre, comme après un remélange
  const replace = (h: Card[], i: number, used: Set<string>) => {
    const old = h[i];
    h[i] = draw(used);
    used.delete(old);
  };
  const runDraws = (h: Card[], from: number, used: Set<string>, first?: number[]) => {
    for (let k = from; k < TOTAL_DRAWS; k++) {
      const d = k === from && first ? first : planDraw(h, TOTAL_DRAWS - k);
      for (const i of d) replace(h, i, used);
    }
  };
  for (let it = 0; it < iterations; it++) {
    const used = new Set<string>([...hero, ...dead]);
    const finals: Card[][] = [];
    for (const o of opps) {
      let h: Card[] = [];
      let ok = false;
      for (let tries = 0; tries < 25 && !ok; tries++) {
        const local = new Set(used);
        h = [draw(local), draw(local), draw(local), draw(local), draw(local)];
        ok = true;
        // avant le tirage : celui qui relance a souvent une main faite ou un tirage à 1 carte
        const first = planDraw(h, TOTAL_DRAWS).length;
        if ((o.pre === 2 && first > 2) || (o.pre === 1 && first > 3)) ok = false;
        // ses tirages déjà faits doivent correspondre à ce qu'on a vu (à une carte près pour les joueurs atypiques)
        for (let k = 0; ok && k < o.draws.length; k++) {
          const d = planDraw(h, TOTAL_DRAWS - k);
          if (Math.abs(d.length - o.draws[k]) > (tries > 15 ? 1 : 0)) ok = false;
          else {
            const thrown = d.length === o.draws[k] ? d : d.slice(0, o.draws[k]);
            for (const i of thrown) replace(h, i, local);
          }
        }
        if (ok || tries === 24) for (const c of h) used.add(c);
      }
      runDraws(h, o.draws.length, used);
      finals.push(h);
    }
    const me = [...hero];
    runDraws(me, heroDrawsDone, used, heroDiscardNow);
    const mine = score27(me);
    let ties = 0;
    let lost = false;
    for (const h of finals) {
      const s = score27(h);
      if (s < mine) {
        lost = true;
        break;
      }
      if (s === mine) ties++;
    }
    if (!lost) eq += 1 / (ties + 1);
  }
  return eq / iterations;
}

/** Équité du héros (ou d'un bot) dans l'état courant. */
export function equity27For(state: HandState, playerId: string, iterations = 300, seed = 7, heroDiscardNow?: number[]): number {
  const me = state.players.find((p) => p.id === playerId)!;
  const opps = opponents27(state, playerId);
  if (!opps.length) return 1;
  const done = state.log.filter((a) => a.playerId === playerId && a.type === 'draw').length;
  // les cartes que ce joueur a jetées ne sont plus dans le paquet (sauf remélange, rare)
  const dead: Card[] = [];
  return equity27(me.holeCards, dead, done, opps, iterations, seed, heroDiscardNow);
}

const withTip = (detail: string, ctx: PreflopContext) => (ctx.info ? `${detail} ${ctx.info.label} : ${stageTip(ctx.info)}` : detail);
const p = (x: number) => `${Math.round(x * 100)} %`;

/** Conseil avant le premier tirage (même logique que l'Omaha : la main est située en « top X % »). */
export function draw27PreChart(hand: HandState, heroIndex: number): OmahaChart | null {
  if (hand.street !== 'preflop' || hand.drawPending?.length) return null;
  const headsUp = hand.players.filter((x) => !x.out).length === 2;
  const pos = positionOf(hand, heroIndex);
  const posFr = POSITION_FR[pos];
  const raises = hand.log.filter((a) => a.street === 'preflop' && (a.type === 'raise' || a.type === 'bet'));
  const ctx = preflopContext(hand, heroIndex);
  const pressure = ctx.info?.pressure ?? 0;
  if (raises.length === 0) {
    if (pos === 'BB')
      return {
        title: 'Grosse blind, personne n’a relancé',
        detail: withTip('Relance avec une main faite à 8 ou mieux, ou un tirage à 1 carte vers un 7 ; sinon parole gratuite.', ctx),
        adviseTop: (t) => (t <= 0.07 ? 'raise' : 'call'),
        legend: [
          { a: 'raise', label: 'Relancer · top 7 %' },
          { a: 'call', label: 'Parole' },
        ],
      };
    const open = Math.min(0.6, openRange(pos, headsUp) * ctx.tighten);
    return {
      title: `Ouverture au 2-7 · ${posFr}`,
      detail: withTip(`Entre en relançant avec le top ${p(open)} : en début de parole, une main faite à 8 ou un tirage à 1 carte vers 7 ou 8 ; plus tard, les tirages à 2 cartes vers un 7 (2-3-7, 2-4-7…). Évite les mains avec des cartes au-dessus de 8.`, ctx),
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
  if (raises.length === 1) {
    const r = openRange(positionOf(hand, raiserIdx), headsUp);
    const value = Math.max(0.03, r * 0.3);
    const call = Math.min(0.45, r * (heroIndex === hand.bbIndex ? 1.3 : 0.8)) * (1 - 0.35 * pressure);
    return {
      title: `${raiser.name} a relancé : sur-relancer, suivre ou passer ?`,
      detail: withTip(`On lui prête le top ${p(r)}. Sur-relance avec le top ${p(value)} (mains faites à 8 et mieux, tirages à 1 carte vers 7), suis jusqu’au top ${p(call)}. Au 2-7, tirer 3 cartes contre une relance coûte cher.`, ctx),
      adviseTop: (t) => (t <= value ? 'raise' : t <= call ? 'call' : 'fold'),
      legend: [
        { a: 'raise', label: `Sur-relancer · top ${p(value)}` },
        { a: 'call', label: 'Suivre' },
        { a: 'fold', label: 'Se coucher' },
      ],
    };
  }
  return {
    title: `${raiser.name} a sur-relancé`,
    detail: withTip('Une sur-relance annonce souvent une main faite basse ou un excellent tirage à 1 carte. Continue avec tes meilleures mains seulement.', ctx),
    adviseTop: (t) => (t <= 0.025 ? 'raise' : t <= 0.1 ? 'call' : 'fold'),
    legend: [
      { a: 'raise', label: 'Relancer · top 2,5 %' },
      { a: 'call', label: 'Suivre' },
      { a: 'fold', label: 'Se coucher' },
    ],
  };
}

export { top27 };
export type { Advice };
