import { type Card, createRng, fullDeck, RANKS, rankValue } from './cards';
import { evaluateBest } from './evaluator';
import type { HandState } from './holdem';
import { RAISE_RANKING as HAND_RANKING } from './handRanking';

/* ---------- Classes de mains et pourcentages ---------- */

const RANKS_DESC = [...RANKS].sort((a, b) => rankValue(b) - rankValue(a)); // A K Q … 2

export const combosOf = (name: string) => (name.length === 2 ? 6 : name.endsWith('s') ? 4 : 12);

/** Part cumulée des 1 326 combinaisons, de la meilleure main jusqu'à celle-ci incluse. */
const CUMUL = new Map<string, number>();
{
  let acc = 0;
  for (const n of HAND_RANKING) {
    acc += combosOf(n);
    CUMUL.set(n, acc / 1326);
  }
}

/** « Top X % » d'une main de départ (AA ≈ 0,5 %, 72o = 100 %). */
export const topPercent = (name: string) => CUMUL.get(name) ?? 1;

/** Toutes les combinaisons concrètes d'une classe (« AKs » → 4 paires de cartes). */
function combosFor(name: string): [Card, Card][] {
  const [r1, r2] = [name[0], name[1]];
  const suits = ['s', 'h', 'd', 'c'];
  const out: [Card, Card][] = [];
  for (const a of suits)
    for (const b of suits) {
      if (r1 === r2 && a >= b) continue;
      if (name.endsWith('s') && a !== b) continue;
      if (name.endsWith('o') && a === b) continue;
      out.push([`${r1}${a}` as Card, `${r2}${b}` as Card]);
    }
  return out;
}
const COMBOS = new Map(HAND_RANKING.map((n) => [n, combosFor(n)]));

/** Grille 13 × 13 classique : paires sur la diagonale, assorties au-dessus, dépareillées en dessous. */
export function gridName(row: number, col: number): string {
  const a = RANKS_DESC[row];
  const b = RANKS_DESC[col];
  if (row === col) return a + a;
  return row < col ? a + b + 's' : b + a + 'o';
}
export const GRID_LABELS = RANKS_DESC.map((r) => (r === 'T' ? '10' : r));

/* ---------- Positions ---------- */

export const POSITION_FR: Record<string, string> = {
  UTG: 'UTG (premier de parole)',
  HJ: 'Hijack',
  CO: 'Cut-off',
  BTN: 'Bouton',
  SB: 'Petite blind',
  BB: 'Grosse blind',
};

/** Part des mains à ouvrir (relance d'ouverture) selon la position, table de 6 au plus. */
const OPEN: Record<string, number> = { UTG: 0.15, HJ: 0.19, CO: 0.27, BTN: 0.45, SB: 0.4, BB: 0.4 };

/** Position d'un joueur (par son index) dans la main. */
export function positionOf(hand: HandState, index: number): string {
  const n = hand.players.length;
  const live = hand.players.map((p, i) => ({ p, i })).filter((x) => !x.p.out);
  if (index === hand.sbIndex) return live.length === 2 ? 'BTN' : 'SB';
  if (index === hand.bbIndex) return 'BB';
  if (index === hand.config.buttonIndex) return 'BTN';
  // on remonte depuis le bouton : CO, HJ, puis UTG
  const order: number[] = [];
  for (let k = 1; k < n; k++) {
    const j = (hand.config.buttonIndex - k + n) % n;
    if (!hand.players[j].out && j !== hand.sbIndex && j !== hand.bbIndex) order.push(j);
  }
  const d = order.indexOf(index);
  return d === 0 ? 'CO' : d === 1 ? 'HJ' : 'UTG';
}

export const openRange = (pos: string, headsUp: boolean) => (headsUp ? 0.8 : OPEN[pos] ?? 0.2);

/* ---------- Ranges estimées des adversaires ---------- */

export interface OpponentRange {
  id: string;
  name: string;
  /** part des meilleures mains qu'on lui prête (1 = n'importe quoi) */
  top: number;
  why: string;
}

/** Ce que l'action préflop dit de la main de chaque adversaire encore en jeu. */
export function estimateRanges(hand: HandState, heroId: string): OpponentRange[] {
  const headsUp = hand.players.filter((p) => !p.out).length === 2;
  const pre = hand.log.filter((a) => a.street === 'preflop' && a.type !== 'post');
  const res: OpponentRange[] = [];
  hand.players.forEach((p, i) => {
    if (p.id === heroId || p.out || p.folded) return;
    let raisesBefore = 0;
    let top = 1;
    let why = 'n’a pas encore parlé';
    for (const a of pre) {
      if (a.playerId === p.id) {
        if (a.type === 'raise' || a.type === 'bet') {
          if (raisesBefore === 0) {
            top = openRange(positionOf(hand, i), headsUp);
            why = `relance d’ouverture (${POSITION_FR[positionOf(hand, i)]})`;
          } else if (raisesBefore === 1) {
            top = 0.07;
            why = '3-bet';
          } else if (raisesBefore === 2) {
            top = 0.03;
            why = '4-bet';
          } else {
            top = 0.015;
            why = 'relance de plus';
          }
        } else if (a.type === 'call') {
          if (raisesBefore === 0) {
            top = Math.min(top, 0.45);
            why = 'a suivi sans relancer';
          } else if (raisesBefore === 1) {
            top = Math.min(top, i === hand.bbIndex ? 0.4 : 0.22);
            why = i === hand.bbIndex ? 'défend sa grosse blind' : 'a suivi une relance';
          } else {
            top = Math.min(top, 0.08);
            why = 'a suivi un 3-bet';
          }
        } else if (a.type === 'check') {
          why = top === 1 ? 'a checké' : why;
        }
      }
      if (a.type === 'raise' || a.type === 'bet') raisesBefore++;
    }
    res.push({ id: p.id, name: p.name, top, why });
  });
  return res;
}

/* ---------- Équité contre des ranges ---------- */

function drawFromRange(top: number, dead: Set<string>, rng: () => number, deck: Card[]): [Card, Card] {
  if (top < 1) {
    // on tire une combinaison au hasard parmi les meilleures « top » mains, pondérées par leur nombre
    const target = Math.max(top, 0.005);
    for (let tries = 0; tries < 40; tries++) {
      const u = rng() * target;
      let name = HAND_RANKING[0];
      for (const n of HAND_RANKING) {
        name = n;
        if ((CUMUL.get(n) ?? 1) >= u) break;
      }
      const list = COMBOS.get(name)!;
      const c = list[Math.floor(rng() * list.length)];
      if (!dead.has(c[0]) && !dead.has(c[1])) return c;
    }
  }
  for (;;) {
    const a = deck[Math.floor(rng() * deck.length)];
    const b = deck[Math.floor(rng() * deck.length)];
    if (a !== b && !dead.has(a) && !dead.has(b)) return [a, b];
  }
}

/** Équité de ta main contre des adversaires à qui on prête chacun une range (part des meilleures mains). */
export function equityVsRanges(hole: Card[], board: Card[], ranges: number[], iterations = 1500, seed = 7): number {
  const rng = createRng(seed);
  const deck = fullDeck();
  let eq = 0;
  for (let it = 0; it < iterations; it++) {
    const dead = new Set<string>([...hole, ...board]);
    const opp: Card[][] = [];
    for (const r of ranges) {
      const h = drawFromRange(r, dead, rng, deck);
      dead.add(h[0]);
      dead.add(h[1]);
      opp.push(h);
    }
    const full = [...board];
    while (full.length < 5) {
      const c = deck[Math.floor(rng() * deck.length)];
      if (!dead.has(c)) {
        dead.add(c);
        full.push(c);
      }
    }
    const mine = evaluateBest([...hole, ...full]).score;
    let ties = 0;
    let lost = false;
    for (const h of opp) {
      const s = evaluateBest([...h, ...full]).score;
      if (s > mine) {
        lost = true;
        break;
      }
      if (s === mine) ties++;
    }
    if (!lost) eq += 1 / (ties + 1);
  }
  return eq / iterations;
}

/* ---------- Conseil de range préflop ---------- */

export type Advice = 'raise' | 'bluff' | 'call' | 'fold';
export const ADVICE_FR: Record<Advice, string> = {
  raise: 'Relancer (valeur)',
  bluff: 'Relancer en bluff',
  call: 'Suivre',
  fold: 'Se coucher',
};

export interface RangeChart {
  title: string;
  detail: string;
  /** action conseillée pour chaque classe de main */
  advise: (name: string) => Advice;
  legend: { a: Advice; label: string }[];
}

const isBluffCandidate = (name: string) =>
  name.endsWith('s') && (name[0] === 'A' || Math.abs(rankValue(`${name[0]}s` as Card) - rankValue(`${name[1]}s` as Card)) === 1);

/** Range conseillée pour la décision préflop du héros, selon ce qui s'est passé avant lui. */
export function preflopChart(hand: HandState, heroIndex: number): RangeChart | null {
  if (hand.street !== 'preflop') return null;
  const headsUp = hand.players.filter((p) => !p.out).length === 2;
  const pos = positionOf(hand, heroIndex);
  const raises = hand.log.filter((a) => a.street === 'preflop' && (a.type === 'raise' || a.type === 'bet'));
  const limps = hand.log.filter((a) => a.street === 'preflop' && a.type === 'call').length;
  const posFr = POSITION_FR[pos];

  if (raises.length === 0) {
    const open = openRange(pos, headsUp) * (limps > 0 ? 0.7 : 1);
    if (pos === 'BB') {
      const iso = 0.2;
      return {
        title: 'Tu es en grosse blind, personne n’a relancé',
        detail: `Relance les meilleures mains (top ${Math.round(iso * 100)} %), sinon parole gratuite.`,
        advise: (n) => (topPercent(n) <= iso ? 'raise' : 'call'),
        legend: [
          { a: 'raise', label: `Relancer · top ${Math.round(iso * 100)} %` },
          { a: 'call', label: 'Parole' },
        ],
      };
    }
    return {
      title: limps > 0 ? `Isoler des joueurs qui ont suivi · ${posFr}` : `Ouverture depuis ta position : ${posFr}`,
      detail:
        limps > 0
          ? `Face à ${limps} limp${limps > 1 ? 's' : ''}, relance un peu plus serré que d’habitude : top ${Math.round(open * 100)} %.`
          : `Plus tu parles tard, plus tu peux ouvrir de mains. Ici : top ${Math.round(open * 100)} %.`,
      advise: (n) => (topPercent(n) <= open ? 'raise' : 'fold'),
      legend: [
        { a: 'raise', label: `Relancer · top ${Math.round(open * 100)} %` },
        { a: 'fold', label: 'Se coucher' },
      ],
    };
  }

  const last = raises[raises.length - 1];
  const raiserIdx = hand.players.findIndex((p) => p.id === last.playerId);
  const raiser = hand.players[raiserIdx];
  if (raises.length === 1) {
    const r = openRange(positionOf(hand, raiserIdx), headsUp);
    const value = Math.max(0.03, r * 0.25);
    const call = Math.min(0.5, r * (heroIndex === hand.bbIndex ? 1 : 0.6));
    const bluffMax = r * 1.3;
    return {
      title: `${raiser.name} a relancé (${POSITION_FR[positionOf(hand, raiserIdx)]}) : faut-il 3-bet ?`,
      detail: `On lui prête le top ${Math.round(r * 100)} %. 3-bet valeur avec le top ${Math.round(value * 100)} %, quelques bluffs avec des mains assorties jouables, suivre le reste du top ${Math.round(call * 100)} %.`,
      advise: (n) => {
        const t = topPercent(n);
        if (t <= value) return 'raise';
        if (t <= call) return 'call';
        if (t <= bluffMax && isBluffCandidate(n)) return 'bluff';
        return 'fold';
      },
      legend: [
        { a: 'raise', label: `3-bet valeur · top ${Math.round(value * 100)} %` },
        { a: 'bluff', label: '3-bet bluff' },
        { a: 'call', label: 'Suivre' },
        { a: 'fold', label: 'Se coucher' },
      ],
    };
  }
  if (raises.length === 2) {
    return {
      title: `${raiser.name} a fait un 3-bet : faut-il 4-bet ?`,
      detail: 'Un 3-bet représente environ le top 7 %. 4-bet avec les toutes meilleures mains, suivre avec les bonnes paires et as forts.',
      advise: (n) => {
        const t = topPercent(n);
        if (t <= 0.025) return 'raise';
        if (t <= 0.075) return 'call';
        if (n === 'A5s' || n === 'A4s') return 'bluff';
        return 'fold';
      },
      legend: [
        { a: 'raise', label: '4-bet valeur · top 2,5 %' },
        { a: 'bluff', label: '4-bet bluff (A5s, A4s)' },
        { a: 'call', label: 'Suivre' },
        { a: 'fold', label: 'Se coucher' },
      ],
    };
  }
  return {
    title: `${raiser.name} a fait un ${raises.length + 1 === 4 ? '4' : raises.length + 1}-bet`,
    detail: 'À ce niveau, on ne continue qu’avec les toutes meilleures mains.',
    advise: (n) => (topPercent(n) <= 0.02 ? 'raise' : topPercent(n) <= 0.035 ? 'call' : 'fold'),
    legend: [
      { a: 'raise', label: 'Tapis · top 2 %' },
      { a: 'call', label: 'Suivre' },
      { a: 'fold', label: 'Se coucher' },
    ],
  };
}

/** Part minimale de fois où l'adversaire doit se coucher pour qu'une relance en bluff soit rentable. */
export const foldEquityNeeded = (risk: number, pot: number) => (risk > 0 ? risk / (risk + pot) : 0);

