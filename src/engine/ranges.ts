import { type Card, createRng, fullDeck, RANKS, rankValue, suitOf } from './cards';
import { evaluateBest, HandCategory } from './evaluator';
import type { HandState } from './holdem';
import { callPrice, callShoveRange, effectiveBB, pushRange, stageOf, type StageInfo } from './tourney';
import { eqVsTops } from './preflopTable';
import { stageTip } from './tips';
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
  'UTG*': 'UTG (premier de parole)',
  'UTG+1': 'UTG+1',
  MP: 'Milieu de table',
  HJ: 'Hijack',
  CO: 'Cut-off',
  BTN: 'Bouton',
  SB: 'Petite blind',
  BB: 'Grosse blind',
};

/** Part des mains à ouvrir (relance d'ouverture) selon la position, table de 6 au plus. */
const OPEN: Record<string, number> = { UTG: 0.15, 'UTG+1': 0.11, MP: 0.14, HJ: 0.19, CO: 0.27, BTN: 0.45, SB: 0.4, BB: 0.4 };
/** À table pleine, le premier de parole joue encore plus serré. */
const OPEN_FULL_UTG = 0.09;

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
  const m = order.length; // joueurs entre les blinds et le bouton
  if (d === m - 1 && m >= 3) return m >= 5 ? 'UTG*' : 'UTG';
  if (d === m - 2 && m >= 5) return 'UTG+1';
  return d === 0 ? 'CO' : d === 1 ? 'HJ' : d === m - 1 ? 'UTG' : 'MP';
}

export const openRange = (pos: string, headsUp: boolean) => (headsUp ? 0.8 : pos === 'UTG*' ? OPEN_FULL_UTG : OPEN[pos] ?? 0.2);

/* ---------- Ranges estimées des adversaires ---------- */

export interface OpponentRange {
  id: string;
  name: string;
  /** part des meilleures mains qu'on lui prête (1 = n'importe quoi) */
  top: number;
  why: string;
  /** ce qu'il a fait après le flop (ça resserre ou élargit sa range) */
  post?: PostflopAct[];
}

/** Action d'un adversaire sur un tour après le flop : 0 parole, 1 suivi, 2 mise, 3 relance ou grosse mise. */
export interface PostflopAct {
  board: Card[];
  level: 0 | 1 | 2 | 3;
}

/** Une range : part des meilleures mains de départ, et éventuellement les actions après le flop. */
export type RangeSpec = number | { top: number; post?: PostflopAct[] };

const STREET_LEN: Record<string, number> = { flop: 3, turn: 4, river: 5 };
const LEVEL_FR = ['a checké', 'a suivi', 'a misé', 'a relancé'];
const STREET_FR: Record<string, string> = { flop: 'au flop', turn: 'au turn', river: 'à la rivière' };

/** Taille du pot juste avant chaque action du journal. */
export function potsBefore(hand: HandState): number[] {
  const out: number[] = [];
  let pot = 0;
  let street = '';
  const bets = new Map<string, number>();
  for (const a of hand.log) {
    if (a.street !== street) {
      street = a.street;
      bets.clear();
    }
    out.push(pot);
    const prev = bets.get(a.playerId) ?? 0;
    const add = a.type === 'bet' || a.type === 'raise' ? a.amount - prev : a.type === 'call' || a.type === 'post' ? a.amount : 0;
    if (a.label !== 'ante') bets.set(a.playerId, prev + add);
    pot += add;
  }
  return out;
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
        const shoveBB = a.allIn ? a.amount / hand.config.bigBlind : 0;
        if ((a.type === 'raise' || a.type === 'bet') && shoveBB > 0 && shoveBB <= 25) {
          // tapis court : range de « tapis ou se coucher », bien plus large qu'une relance profonde
          const pos = positionOf(hand, i);
          top = raisesBefore === 0 ? pushRange(pos, shoveBB, headsUp) : raisesBefore === 1 ? Math.min(0.35, 0.14 * Math.pow(20 / shoveBB, 0.6)) : 0.06;
          why = raisesBefore === 0 ? `tapis à ${Math.round(shoveBB)} BB (${POSITION_FR[pos]})` : `relance à tapis à ${Math.round(shoveBB)} BB`;
        } else if (a.type === 'raise' || a.type === 'bet') {
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
          const facing = hand.log.filter((x) => x.street === 'preflop' && (x.type === 'raise' || x.type === 'bet')).slice(0, raisesBefore).pop();
          if (raisesBefore >= 1 && facing?.allIn && facing.amount / hand.config.bigBlind <= 25) {
            top = Math.min(top, callShoveRange(top === 1 ? 0.3 : top, facing.amount / hand.config.bigBlind));
            why = 'a payé un tapis';
          } else if (raisesBefore === 0) {
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
    // après le flop : on retient l'action la plus forte de chaque tour
    const post: PostflopAct[] = [];
    const pots = potsBefore(hand);
    for (const st of ['flop', 'turn', 'river']) {
      const acts = hand.log.map((a, k) => ({ a, k })).filter(({ a }) => a.street === st && a.playerId === p.id && a.type !== 'fold' && a.type !== 'post');
      if (!acts.length) continue;
      let level: 0 | 1 | 2 | 3 = 0;
      for (const { a, k } of acts) {
        const potBefore = Math.max(1, pots[k]);
        const l = a.type === 'raise' ? 3 : a.type === 'bet' ? (a.allIn || a.amount >= potBefore * 0.6 ? 3 : 2) : a.type === 'call' ? 1 : 0;
        if (l > level) level = l as 0 | 1 | 2 | 3;
      }
      post.push({ board: hand.board.slice(0, STREET_LEN[st]), level });
    }
    if (post.length) {
      const last = post[post.length - 1];
      const st = last.board.length === 3 ? 'flop' : last.board.length === 4 ? 'turn' : 'river';
      why += ` · ${LEVEL_FR[last.level]} ${STREET_FR[st]}`;
    }
    res.push({ id: p.id, name: p.name, top, why, post: post.length ? post : undefined });
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

/**
 * Catégorie d'une main sur un tableau, pour savoir si elle mise ou suit volontiers :
 * 0 rien, 1 tirage, 2 petite paire, 3 top paire ou overpaire, 4 très forte (deux paires et mieux).
 */
export function handClass(hole: Card[], board: Card[]): 0 | 1 | 2 | 3 | 4 {
  const v = evaluateBest([...hole, ...board]);
  const br = board.map(rankValue);
  const top = Math.max(...br);
  const [h1, h2] = hole.map(rankValue);
  const pocket = h1 === h2;
  const on = (r: number) => br.includes(r);
  const boardPaired = new Set(br).size < br.length;
  let cls: 0 | 1 | 2 | 3 | 4 = 0;
  const c = v.category;
  if (c >= HandCategory.Straight) {
    const boardOnly = board.length === 5 && evaluateBest(board).category === c;
    cls = boardOnly ? 1 : 4;
  } else if (c === HandCategory.Trips) cls = (pocket && on(h1)) || (!pocket && (on(h1) || on(h2))) ? 4 : 0;
  else if (c === HandCategory.TwoPair) {
    if (!pocket && on(h1) && on(h2) && h1 !== h2) cls = 4;
    else if (pocket) cls = h1 > top ? 3 : 2;
    else if (on(h1) || on(h2)) cls = Math.max(on(h1) ? h1 : 0, on(h2) ? h2 : 0) === top ? 3 : 2;
    else cls = 0;
  } else if (c === HandCategory.Pair && !(boardPaired && !pocket && !on(h1) && !on(h2))) {
    if (pocket) cls = h1 > top ? 3 : 2;
    else cls = (on(h1) && h1 === top) || (on(h2) && h2 === top) ? 3 : 2;
  }
  if (cls >= 2 || board.length >= 5) return cls;
  // tirages couleur et quinte
  const cards = [...hole, ...board];
  for (const s of 'cdhs') if (cards.filter((x) => suitOf(x) === s).length >= 4 && hole.some((x) => suitOf(x) === s)) return 1;
  const ranks = new Set(cards.map(rankValue));
  if (ranks.has(14)) ranks.add(1);
  for (let lo = 1; lo <= 10; lo++) {
    let n = 0;
    let mine = false;
    for (let r = lo; r < lo + 5; r++)
      if (ranks.has(r)) {
        n++;
        if (r === h1 || r === h2 || (r === 1 && (h1 === 14 || h2 === 14))) mine = true;
      }
    if (n >= 4 && mine) return 1;
  }
  return cls;
}

/** Probabilité qu'une main de chaque catégorie fasse cette action (parole, suivi, mise, relance). */
const ACCEPT: number[][] = [
  [1, 0.9, 1, 0.75, 0.4],
  [0.2, 1, 0.75, 1, 0.85],
  [0.3, 0.7, 0.45, 0.9, 1],
  [0.12, 0.4, 0.12, 0.45, 1],
];

function weightOf(h: Card[], post: PostflopAct[]): number {
  let w = 1;
  for (const a of post) w *= ACCEPT[a.level][handClass(h, a.board)];
  return w;
}

function drawFromSpec(spec: RangeSpec, dead: Set<string>, rng: () => number, deck: Card[]): [Card, Card] {
  if (typeof spec === 'number') return drawFromRange(spec, dead, rng, deck);
  if (!spec.post?.length) return drawFromRange(spec.top, dead, rng, deck);
  let h = drawFromRange(spec.top, dead, rng, deck);
  for (let tries = 0; tries < 30; tries++) {
    if (rng() < weightOf(h, spec.post)) return h;
    h = drawFromRange(spec.top, dead, rng, deck);
  }
  return h;
}

/** Équité de ta main contre des adversaires à qui on prête chacun une range (part des meilleures mains, et actions après le flop). */
export function equityVsRanges(hole: Card[], board: Card[], ranges: RangeSpec[], iterations = 1500, seed = 7): number {
  const rng = createRng(seed);
  const deck = fullDeck();
  let eq = 0;
  for (let it = 0; it < iterations; it++) {
    const dead = new Set<string>([...hole, ...board]);
    const opp: Card[][] = [];
    for (const r of ranges) {
      const h = drawFromSpec(r, dead, rng, deck);
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

/** Contexte d'une décision préflop : stade du tournoi, tapis effectif, pression ICM. */
export interface PreflopContext {
  info: StageInfo | null;
  effBB: number;
  /** le joueur couvre-t-il tous les autres ? */
  covers: boolean;
  /** multiplicateur des ranges d'ouverture et de tapis selon la bulle */
  tighten: number;
}

export function preflopContext(hand: HandState, idx: number): PreflopContext {
  const info = stageOf(hand);
  const effBB = effectiveBB(hand, idx);
  const me = hand.players[idx];
  const mine = me.stack + me.committed;
  const covers = hand.players.every((p, i) => i === idx || p.out || p.stack + p.committed <= mine);
  const pressure = info?.pressure ?? 0;
  const tighten = covers ? 1 + 0.25 * pressure : 1 - 0.3 * pressure;
  return { info, effBB, covers, tighten };
}

const withTip = (detail: string, ctx: PreflopContext) => (ctx.info ? `${detail} ${ctx.info.label} : ${stageTip(ctx.info)}` : detail);
const bbFr = (x: number) => `${Math.round(x)} BB`;

/** Range conseillée pour la décision préflop du héros, selon ce qui s'est passé avant lui, son tapis et le stade du tournoi. */
export function preflopChart(hand: HandState, heroIndex: number): RangeChart | null {
  if (hand.street !== 'preflop') return null;
  const headsUp = hand.players.filter((p) => !p.out).length === 2;
  const pos = positionOf(hand, heroIndex);
  const raises = hand.log.filter((a) => a.street === 'preflop' && (a.type === 'raise' || a.type === 'bet'));
  const limps = hand.log.filter((a) => a.street === 'preflop' && a.type === 'call').length;
  const posFr = POSITION_FR[pos];
  const ctx = preflopContext(hand, heroIndex);
  const me = hand.players[heroIndex];
  const nl = hand.config.structure !== 'FL';
  const shortStack = nl && ctx.effBB <= 12;

  if (raises.length === 0) {
    if (pos === 'BB') {
      const iso = shortStack ? Math.min(0.5, pushRange('BB', ctx.effBB, headsUp) * 0.5) : 0.2;
      return {
        title: shortStack ? `Grosse blind, ${bbFr(ctx.effBB)} : tapis sur les limps ?` : 'Tu es en grosse blind, personne n’a relancé',
        detail: withTip(shortStack ? `Pousse à tapis le top ${Math.round(iso * 100)} %, sinon parole gratuite.` : `Relance les meilleures mains (top ${Math.round(iso * 100)} %), sinon parole gratuite.`, ctx),
        advise: (n) => (topPercent(n) <= iso ? 'raise' : 'call'),
        legend: [
          { a: 'raise', label: `${shortStack ? 'Tapis' : 'Relancer'} · top ${Math.round(iso * 100)} %` },
          { a: 'call', label: 'Parole' },
        ],
      };
    }
    if (shortStack) {
      const push = Math.min(1, pushRange(pos, ctx.effBB, headsUp) * ctx.tighten * (limps > 0 ? 0.7 : 1));
      return {
        title: `Tapis ou se coucher · ${bbFr(ctx.effBB)} · ${posFr}`,
        detail: withTip(`Avec ${bbFr(ctx.effBB)}, une relance normale t’engage déjà : pousse à tapis le top ${Math.round(push * 100)} %, couche le reste.`, ctx),
        advise: (n) => (topPercent(n) <= push ? 'raise' : 'fold'),
        legend: [
          { a: 'raise', label: `Tapis · top ${Math.round(push * 100)} %` },
          { a: 'fold', label: 'Se coucher' },
        ],
      };
    }
    let open = openRange(pos, headsUp) * (limps > 0 ? 0.7 : 1) * ctx.tighten;
    // en fin de tournoi, les blinds valent cher : on vole plus en fin de parole
    if (ctx.info && ctx.effBB <= 25 && ['CO', 'BTN', 'SB'].includes(pos)) open *= 1.12;
    open = Math.min(0.9, open);
    return {
      title: limps > 0 ? `Isoler des joueurs qui ont suivi · ${posFr}` : `Ouverture depuis ta position : ${posFr}`,
      detail: withTip(
        limps > 0
          ? `Face à ${limps} limp${limps > 1 ? 's' : ''}, relance un peu plus serré que d’habitude : top ${Math.round(open * 100)} %.`
          : `Plus tu parles tard, plus tu peux ouvrir de mains. Ici : top ${Math.round(open * 100)} %.${ctx.effBB <= 25 ? ' Avec ce tapis, relance petit (2 à 2,2 BB).' : ''}`,
        ctx,
      ),
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
  const toCall = Math.min(hand.currentBet - me.bet, me.stack);
  const bigCall = nl && (last.allIn || toCall >= me.stack * 0.4);

  // Gros call (tapis adverse ou mise qui engage) : on compare l'équité au prix, ICM compris
  if (bigCall) {
    const opp = estimateRanges(hand, me.id).filter((r) => r.id === raiser.id || hand.log.some((a) => a.street === 'preflop' && a.playerId === r.id && a.type === 'call'));
    const ws = opp.map((r) => r.top);
    const price = callPrice(hand, heroIndex, raiserIdx);
    const need = price.icm;
    const icmNote = price.icm > price.chip + 0.015 ? ` ICM (${ctx.info?.label.toLowerCase()}) : il te faut ${Math.round(price.icm * 100)} % au lieu de ${Math.round(price.chip * 100)} % en jetons.` : '';
    const vr = opp.find((r) => r.id === raiser.id);
    return {
      title: `${raiser.name} ${last.allIn ? 'a fait tapis' : 'a fait une grosse relance'} : payer ou se coucher ?`,
      detail: withTip(
        `On lui prête le top ${Math.round((vr?.top ?? 0.1) * 100)} % (${vr?.why ?? 'relance'}). Il te faut ${Math.round(need * 100)} % de chances de gagner pour payer.${icmNote}`,
        ctx,
      ),
      advise: (n) => (eqVsTops(n, ws) >= need ? 'call' : 'fold'),
      legend: [
        { a: 'call', label: `Payer · équité ≥ ${Math.round(need * 100)} %` },
        { a: 'fold', label: 'Se coucher' },
      ],
    };
  }

  if (raises.length === 1) {
    const r = openRange(positionOf(hand, raiserIdx), headsUp);
    // Tapis de 12 à 25 BB : relancer à tapis plutôt que suivre
    if (nl && ctx.effBB <= 25) {
      const shove = Math.min(0.35, Math.max(0.05, r * 0.45 * Math.pow(20 / ctx.effBB, 0.5)) * ctx.tighten);
      const call = ctx.effBB > 18 && !ctx.info?.pressure ? Math.min(shove * 1.6, r * 0.6) : 0;
      return {
        title: `${raiser.name} a relancé, tu as ${bbFr(ctx.effBB)} : relance à tapis ?`,
        detail: withTip(`On lui prête le top ${Math.round(r * 100)} %. À ce tapis, pousser à tapis (top ${Math.round(shove * 100)} %) vaut mieux que suivre : tu gagnes souvent la relance et les blinds sans voir le flop.`, ctx),
        advise: (n) => {
          const t = topPercent(n);
          if (t <= shove) return 'raise';
          if (t <= call && (n.length === 2 || n.endsWith('s'))) return 'call';
          return 'fold';
        },
        legend: [
          { a: 'raise', label: `Tapis · top ${Math.round(shove * 100)} %` },
          ...(call ? [{ a: 'call' as Advice, label: 'Suivre (paires, assorties)' }] : []),
          { a: 'fold', label: 'Se coucher' },
        ],
      };
    }
    const value = Math.max(0.03, r * 0.25);
    // à la bulle, on suit moins : on 3-bet ou on se couche
    const call = Math.min(0.5, r * (heroIndex === hand.bbIndex ? 1 : 0.6)) * (1 - 0.35 * (ctx.info?.pressure ?? 0));
    const bluffMax = r * 1.3;
    return {
      title: `${raiser.name} a relancé (${POSITION_FR[positionOf(hand, raiserIdx)]}) : faut-il 3-bet ?`,
      detail: withTip(`On lui prête le top ${Math.round(r * 100)} %. 3-bet valeur avec le top ${Math.round(value * 100)} %, quelques bluffs avec des mains assorties jouables, suivre le reste du top ${Math.round(call * 100)} %.`, ctx),
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
      detail: withTip('Un 3-bet représente environ le top 7 %. 4-bet avec les toutes meilleures mains, suivre avec les bonnes paires et as forts.', ctx),
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
    title: `${raiser.name} a fait un ${raises.length + 1}-bet`,
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

