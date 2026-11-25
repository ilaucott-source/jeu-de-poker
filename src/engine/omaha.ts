import { type Card, createRng, fullDeck, rankValue, suitOf } from './cards';
import { CATEGORY_NAMES_FR, categoryOf, HandCategory, omahaScore } from './evaluator';
import { ACCEPT, type PostflopAct, type RangeSpec } from './ranges';

/* ---------- Force d'une main de départ d'Omaha (4 cartes) ---------- */

const PAIR_PTS: Record<number, number> = { 14: 24, 13: 16, 12: 13, 11: 11, 10: 10, 9: 8, 8: 7, 7: 6, 6: 5, 5: 4, 4: 4, 3: 3, 2: 3 };
const suitPts = (high: number) => (high === 14 ? 8 : high === 13 ? 5.5 : high === 12 ? 4.5 : high >= 10 ? 3.5 : 2.5);
const GAP_PTS = [0, 4, 3, 2, 1];

/**
 * Points d'une main de départ, dans l'esprit du barème de Hutchison :
 * paires (surtout hautes), couleurs possibles (surtout à l'As), cartes qui se suivent (quintes),
 * cartes hautes, et pénalité pour une carte « isolée » qui ne travaille avec aucune autre.
 */
export function omahaPoints(hole: Card[]): number {
  const ranks = hole.map(rankValue);
  const suits = hole.map(suitOf);
  let pts = 0;
  const count = new Map<number, number>();
  for (const r of ranks) count.set(r, (count.get(r) ?? 0) + 1);
  for (const [r, n] of count) {
    if (n === 2) pts += PAIR_PTS[r];
    else if (n === 3) pts += PAIR_PTS[r] * 0.35; // brelan en main : une carte morte
  }
  const bySuit = new Map<string, number[]>();
  suits.forEach((s, i) => bySuit.set(s, [...(bySuit.get(s) ?? []), ranks[i]]));
  for (const rs of bySuit.values()) {
    if (rs.length < 2) continue;
    const p = suitPts(Math.max(...rs));
    pts += rs.length === 2 ? p : rs.length === 3 ? p * 0.6 : -1;
  }
  const u = [...count.keys()].sort((a, b) => b - a);
  for (let i = 0; i < u.length; i++)
    for (let j = i + 1; j < u.length; j++) {
      const gap = u[i] - u[j];
      if (gap <= 4) pts += GAP_PTS[gap] * (u[j] >= 9 ? 1.25 : u[j] >= 6 ? 1 : 0.7);
    }
  if (count.has(14)) for (const r of u) if (r <= 5) pts += 1; // roue A-2-3-4-5
  for (const r of ranks) if (r >= 10) pts += (r - 9) * 0.6;
  // carte isolée : ni paire, ni couleur avec une autre, ni proche d'une autre
  hole.forEach((c, i) => {
    const r = ranks[i];
    if ((count.get(r) ?? 0) > 1) return;
    if ((bySuit.get(suits[i])?.length ?? 0) > 1) return;
    if (u.some((x) => x !== r && Math.abs(x - r) <= 4)) return;
    if (r === 14 && u.some((x) => x <= 5 && x !== r)) return;
    void c;
    pts -= 3;
  });
  return pts;
}

let SORTED: Float64Array | null = null;
const SAMPLE = 40000;
/** Points de mains tirées au hasard, triés du meilleur au pire : sert à situer une main en « top X % ». */
function sorted(): Float64Array {
  if (SORTED) return SORTED;
  const rng = createRng(20261125);
  const deck = fullDeck();
  const arr = new Float64Array(SAMPLE);
  for (let k = 0; k < SAMPLE; k++) {
    for (let i = 0; i < 4; i++) {
      const j = i + Math.floor(rng() * (52 - i));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    arr[k] = omahaPoints(deck.slice(0, 4));
  }
  arr.sort();
  arr.reverse();
  SORTED = arr;
  return arr;
}

/** Part des mains d'Omaha au moins aussi bonnes (0 = la meilleure, 1 = la pire). */
export function omahaTop(hole: Card[]): number {
  const s = omahaPoints(hole);
  const a = sorted();
  // nombre de mains d'au moins s points (tableau décroissant)
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] >= s) lo = m + 1;
    else hi = m;
  }
  return Math.max(0.001, lo / a.length);
}

/** Points minimum pour être dans le top `top`. */
function threshold(top: number): number {
  const a = sorted();
  return a[Math.max(0, Math.min(a.length - 1, Math.floor(top * a.length)))];
}

/** Nom court : rangs du plus haut au plus bas, suivi de « ds » (double suitée) ou « s » (suitée). */
export function omahaName(hole: Card[]): string {
  const sortedCards = [...hole].sort((a, b) => rankValue(b) - rankValue(a));
  const counts = new Map<string, number>();
  for (const c of hole) counts.set(suitOf(c), (counts.get(suitOf(c)) ?? 0) + 1);
  const pairsOfSuits = [...counts.values()].filter((n) => n >= 2).length;
  const suffix = pairsOfSuits === 2 ? 'ds' : pairsOfSuits === 1 ? 's' : '';
  return sortedCards.map((c) => c[0]).join('') + suffix;
}

const RANK_FR: Record<number, string> = { 14: 'As', 13: 'Rois', 12: 'Dames', 11: 'Valets', 10: '10', 9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2' };

/** Ce qui fait la valeur (ou la faiblesse) d'une main de départ, en mots simples. */
export function omahaFeatures(hole: Card[]): string[] {
  const ranks = hole.map(rankValue);
  const out: string[] = [];
  const count = new Map<number, number>();
  for (const r of ranks) count.set(r, (count.get(r) ?? 0) + 1);
  const pairs = [...count.entries()].filter(([, n]) => n === 2).map(([r]) => r).sort((a, b) => b - a);
  if (pairs.length === 2) out.push(`deux paires (${RANK_FR[pairs[0]]} et ${RANK_FR[pairs[1]]})`);
  else if (pairs.length === 1) out.push(pairs[0] === 14 ? 'paire d’As' : `paire de ${RANK_FR[pairs[0]]}`);
  if ([...count.values()].some((n) => n >= 3)) out.push('brelan en main (une carte inutile)');
  const bySuit = new Map<string, number[]>();
  hole.forEach((c, i) => bySuit.set(suitOf(c), [...(bySuit.get(suitOf(c)) ?? []), ranks[i]]));
  const suited = [...bySuit.values()].filter((v) => v.length >= 2);
  if (suited.length === 2) out.push(suited.some((v) => v.includes(14)) ? 'double suitée, dont une à l’As' : 'double suitée');
  else if (suited.length === 1) out.push(suited[0].length > 2 ? `${suited[0].length} cartes de la même couleur (moins bien que 2)` : suited[0].includes(14) ? 'suitée à l’As' : 'suitée');
  else out.push('aucune couleur possible');
  const u = [...count.keys()].sort((a, b) => b - a);
  const span = u[0] - u[u.length - 1];
  if (u.length === 4 && span <= 4) out.push(span === 3 ? 'quatre cartes qui se suivent' : 'très connectée');
  else if (u.length >= 3 && u.slice(0, 3).every((r, i, a) => i === 0 || a[i - 1] - r <= 2)) out.push('bien connectée');
  return out;
}

/* ---------- Mains possibles des adversaires ---------- */

/** Tire 4 cartes parmi le top `top` des mains (tirage avec rejet). */
export function drawOmahaHand(top: number, dead: Set<string>, rng: () => number, deck: Card[]): Card[] {
  const min = top < 1 ? threshold(Math.max(0.004, top)) : -Infinity;
  let h: Card[] = [];
  for (let tries = 0; tries < 300; tries++) {
    h = [];
    while (h.length < 4) {
      const c = deck[Math.floor(rng() * deck.length)];
      if (!dead.has(c) && !h.includes(c)) h.push(c);
    }
    if (min === -Infinity || omahaPoints(h) >= min) return h;
  }
  return h;
}

/**
 * Catégorie d'une main d'Omaha sur un tableau (comme au Hold'em) :
 * 0 rien, 1 tirage, 2 paire haute, 3 deux paires hautes ou brelan par le tableau, 4 très forte (brelan, quinte et mieux).
 */
export function omahaClass(hole: Card[], board: Card[]): 0 | 1 | 2 | 3 | 4 {
  const cat = categoryOf(omahaScore(hole, board));
  const br = board.map(rankValue);
  const hr = hole.map(rankValue);
  const top = Math.max(...br);
  const boardPaired = new Set(br).size < br.length;
  if (cat >= HandCategory.Straight) return 4;
  if (cat === HandCategory.Trips) {
    // brelan servi (paire en main + une carte du tableau) ou brelan grâce au tableau pairé
    const set = hr.some((r, i) => hr.indexOf(r) !== i && br.includes(r));
    if (set) return 4;
    return 3;
  }
  let cls: 0 | 1 | 2 | 3 = 0;
  if (cat === HandCategory.TwoPair) {
    const mine = hr.filter((r) => br.includes(r));
    const sortedBoard = [...new Set(br)].sort((a, b) => b - a);
    if (!boardPaired && mine.includes(sortedBoard[0]) && mine.includes(sortedBoard[1])) cls = 3;
    else cls = 2;
  } else if (cat === HandCategory.Pair) {
    const over = hr.some((r, i) => hr.indexOf(r) !== i && r > top);
    if (over || hr.includes(top)) cls = 2;
  }
  if (cls >= 2 || board.length >= 5) return cls;
  // tirage couleur : 2 cartes d'une couleur en main et 2 au tableau
  for (const s of 'cdhs') {
    const inHand = hole.filter((c) => suitOf(c) === s).length;
    const onBoard = board.filter((c) => suitOf(c) === s).length;
    if (inHand >= 2 && onBoard >= 2) return 1;
  }
  // tirage quinte : 4 rangs sur 5 consécutifs avec exactement 2 cartes de la main
  const hs = new Set(hr.flatMap((r) => (r === 14 ? [14, 1] : [r])));
  const bs = new Set(br.flatMap((r) => (r === 14 ? [14, 1] : [r])));
  for (let lo = 1; lo <= 10; lo++) {
    let h = 0;
    let b = 0;
    for (let r = lo; r < lo + 5; r++) {
      if (hs.has(r)) h++;
      else if (bs.has(r)) b++;
    }
    if (Math.min(h, 2) + Math.min(b, 3) >= 4 && h >= 2 && b >= 2) return 1;
  }
  return cls;
}

function weightOf(h: Card[], post: PostflopAct[]): number {
  let w = 1;
  for (const a of post) w *= ACCEPT[a.level][omahaClass(h, a.board)];
  return w;
}

function drawFromSpec(spec: RangeSpec, dead: Set<string>, rng: () => number, deck: Card[]): Card[] {
  const top = typeof spec === 'number' ? spec : spec.top;
  const post = typeof spec === 'number' ? undefined : spec.post;
  let h = drawOmahaHand(top, dead, rng, deck);
  if (!post?.length) return h;
  for (let tries = 0; tries < 20; tries++) {
    if (rng() < weightOf(h, post)) return h;
    h = drawOmahaHand(top, dead, rng, deck);
  }
  return h;
}

/** Équité d'une main d'Omaha contre des adversaires à qui on prête une range (et leurs actions après le flop). */
export function omahaEquityVsRanges(hole: Card[], board: Card[], ranges: RangeSpec[], iterations = 600, seed = 7): number {
  const rng = createRng(seed);
  const deck = fullDeck();
  let eq = 0;
  for (let it = 0; it < iterations; it++) {
    const dead = new Set<string>([...hole, ...board]);
    const opp: Card[][] = [];
    for (const r of ranges) {
      const h = drawFromSpec(r, dead, rng, deck);
      for (const c of h) dead.add(c);
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
    const mine = omahaScore(hole, full);
    let ties = 0;
    let lost = false;
    for (const h of opp) {
      const s = omahaScore(h, full);
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

/** Outs à l'Omaha : cartes qui font monter la catégorie de ta main (avec 2 cartes de ta main exactement). */
export function omahaOuts(hole: Card[], board: Card[]): { card: Card; makes: string }[] {
  if (board.length < 3 || board.length > 4) return [];
  const known = new Set<string>([...hole, ...board]);
  const now = categoryOf(omahaScore(hole, board));
  const res: { card: Card; makes: string }[] = [];
  for (const c of fullDeck()) {
    if (known.has(c)) continue;
    const cat = categoryOf(omahaScore(hole, [...board, c]));
    if (cat <= now) continue;
    // une paire (ou double paire) faite par une carte qui pairait seulement le tableau ne compte pas
    if (cat <= HandCategory.TwoPair && !hole.some((h) => rankValue(h) === rankValue(c))) continue;
    res.push({ card: c, makes: CATEGORY_NAMES_FR[cat] });
  }
  return res;
}

/**
 * Équité préflop approchée d'une main (située en « top t ») contre des adversaires qui jouent le top w :
 * à l'Omaha, les équités sont serrées (rarement plus de 65 % contre une seule main).
 */
export function omahaPreflopEquity(t: number, ws: number[]): number {
  if (!ws.length) return 1;
  const e1 = ws.map((w) => {
    const m = Math.max(0.02, w / 2);
    return 0.5 + 0.17 * Math.tanh((2.2 * (m - t)) / (m + 0.05));
  });
  const n = ws.length;
  const corr = 1 / (n + 1) / Math.pow(0.5, n);
  return Math.min(0.95, e1.reduce((a, b) => a * b, 1) * corr);
}

/** Nom lisible : « AKQJ double suitée ». */
export function omahaLabel(hole: Card[]): string {
  const n = omahaName(hole);
  if (n.endsWith('ds')) return `${n.slice(0, 4)} double suitée`;
  if (n.endsWith('s')) return `${n.slice(0, 4)} suitée`;
  return n;
}
