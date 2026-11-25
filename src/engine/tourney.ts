import { potTotal, type HandState } from './holdem';

/**
 * Dynamiques de tournoi : stade, tapis en grosses blinds, bulle et ICM.
 *
 * ICM (Independent Chip Model, Malmuth-Harville) : la valeur d'un tapis en argent
 * n'est pas proportionnelle aux jetons. Perdre ses jetons coûte plus que ce qu'en gagner
 * rapporte, surtout près des places payées : il faut donc plus d'équité pour payer un tapis.
 */

export type Stage = 'early' | 'middle' | 'late' | 'near-bubble' | 'bubble' | 'itm' | 'headsup';

export const STAGE_FR: Record<Stage, string> = {
  early: 'Début de tournoi',
  middle: 'Milieu de tournoi',
  late: 'Fin de tournoi (blinds élevées)',
  'near-bubble': 'Approche de la bulle',
  bubble: 'Bulle',
  itm: 'Dans l’argent',
  headsup: 'Tête-à-tête final',
};

export interface StageInfo {
  stage: Stage;
  label: string;
  alive: number;
  paid: number;
  /** tapis moyen des joueurs encore en lice, en grosses blinds */
  avgBB: number;
  /** pression ICM de 0 (aucune) à 1 (bulle) */
  pressure: number;
  payouts: number[];
}

/** Gains des joueurs encore en lice selon l'ICM (même unité que payouts). */
export function icmValues(stacks: number[], payouts: number[]): number[] {
  const n = stacks.length;
  const total = stacks.reduce((a, b) => a + b, 0);
  const res = new Array(n).fill(0);
  if (!total) return res;
  const places = Math.min(payouts.length, n);
  // memo[mask] = probabilité d'atteindre l'état où les joueurs de mask ont pris les premières places
  const memo = new Map<number, number>();
  memo.set(0, 1);
  const order: number[][] = [[0]];
  for (let k = 0; k < places; k++) {
    const next = new Set<number>();
    for (const mask of order[k]) {
      const p = memo.get(mask)!;
      let rest = 0;
      for (let i = 0; i < n; i++) if (!(mask & (1 << i))) rest += stacks[i];
      if (rest <= 0) continue;
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i) || stacks[i] <= 0) continue;
        const q = (p * stacks[i]) / rest;
        res[i] += q * payouts[k];
        const m2 = mask | (1 << i);
        memo.set(m2, (memo.get(m2) ?? 0) + q);
        next.add(m2);
      }
    }
    order.push([...next]);
  }
  return res;
}

const alivePlayers = (h: HandState) => h.players.filter((p) => !p.out && p.stack + p.committed > 0);

/** Stade du tournoi pour cette main, ou null en cash game. */
export function stageOf(h: HandState): StageInfo | null {
  const pay = h.config.tourney?.payouts;
  if (!pay) return null;
  const alive = alivePlayers(h);
  const n = alive.length;
  const paid = Math.min(pay.length, h.players.length);
  const avgBB = alive.reduce((a, p) => a + p.stack + p.committed, 0) / Math.max(1, n) / h.config.bigBlind;
  let stage: Stage;
  let pressure = 0;
  if (n <= 2) stage = 'headsup';
  else if (n <= paid) {
    stage = 'itm';
    pressure = paid > 1 ? 0.45 : 0;
  } else if (n === paid + 1 && paid > 1) {
    stage = 'bubble';
    pressure = 1;
  } else if (n === paid + 2 && paid > 1) {
    stage = 'near-bubble';
    pressure = 0.6;
  } else if (avgBB >= 40) stage = 'early';
  else if (avgBB >= 20) stage = 'middle';
  else stage = 'late';
  if (paid <= 1) pressure = 0; // le gagnant prend tout : pas d'ICM
  return { stage, label: STAGE_FR[stage], alive: n, paid, avgBB, pressure, payouts: pay.slice(0, paid) };
}

/** Tapis effectif (en BB) d'un joueur face aux adversaires encore dans le coup. */
export function effectiveBB(h: HandState, idx: number): number {
  const me = h.players[idx];
  const mine = me.stack + me.bet;
  const others = h.players.filter((p, i) => i !== idx && !p.out && !p.folded).map((p) => p.stack + p.bet);
  const biggest = others.length ? Math.max(...others) : mine;
  return Math.min(mine, biggest) / h.config.bigBlind;
}

export interface CallPrice {
  /** équité nécessaire en jetons (cote du pot) */
  chip: number;
  /** équité nécessaire en tenant compte de l'ICM */
  icm: number;
}

/**
 * Équité nécessaire pour suivre un tapis (ou une grosse mise) face à un adversaire,
 * en jetons et selon l'ICM. Les autres joueurs sont supposés se coucher.
 */
export function callPrice(h: HandState, heroIdx: number, villainIdx: number): CallPrice {
  const me = h.players[heroIdx];
  const v = h.players[villainIdx];
  const risk = Math.min(h.currentBet - me.bet, me.stack);
  const excess = Math.max(0, v.bet - (me.bet + risk));
  const pot = potTotal(h) - excess;
  const chip = risk > 0 ? risk / (pot + risk) : 0;
  const info = stageOf(h);
  if (!info || info.pressure === 0 || risk <= 0) return { chip, icm: chip };
  const alive = h.players.map((p, i) => ({ p, i })).filter((x) => !x.p.out && x.p.stack + x.p.committed > 0);
  const base = alive.map((x) => x.p.stack);
  const hi = alive.findIndex((x) => x.i === heroIdx);
  const vi = alive.findIndex((x) => x.i === villainIdx);
  if (hi < 0 || vi < 0) return { chip, icm: chip };
  // jetons déjà au milieu : ils vont au gagnant du coup
  const fold = [...base];
  fold[vi] = v.stack + pot + excess;
  const win = [...base];
  win[hi] = me.stack + pot;
  win[vi] = v.stack + excess;
  const lose = [...base];
  lose[hi] = me.stack - risk;
  lose[vi] = v.stack + excess + pot + risk;
  const val = (s: number[]) => icmValues(s.map((x) => Math.max(0, x)), info.payouts)[hi];
  const vf = val(fold);
  const vw = val(win);
  const vl = val(lose);
  if (vw - vl <= 1e-9) return { chip, icm: chip };
  const icm = Math.min(0.95, Math.max(chip, (vf - vl) / (vw - vl)));
  return { chip, icm };
}

/* ---------- Tapis ou se coucher (push/fold) ---------- */

/**
 * Part des mains à pousser à tapis, premier à parler, selon la position et le tapis effectif.
 * Ordres de grandeur des tables de Nash (sans ante) : petite blind ~57 % à 10 BB, ~74 % à 5 BB ;
 * bouton ~35 % ; premier de parole ~12 %.
 */
const PUSH_BASE: Record<string, number> = { SB: 0.57, BTN: 0.36, CO: 0.27, HJ: 0.21, MP: 0.17, 'UTG+1': 0.13, UTG: 0.14, 'UTG*': 0.11, BB: 0.57 };

export function pushRange(pos: string, effBB: number, headsUp: boolean): number {
  const base = headsUp ? 0.6 : PUSH_BASE[pos] ?? 0.2;
  const f = Math.pow(10 / Math.max(1.5, effBB), 0.75);
  return Math.min(1, base * f);
}

/** Part des mains avec lesquelles payer un tapis adverse (approximation des tables de Nash). */
export function callShoveRange(shoverRange: number, effBB: number): number {
  // contre un pousseur très large, on paie plus large ; plus le tapis est court, plus la cote est bonne
  const f = Math.pow(10 / Math.max(1.5, effBB), 0.5);
  return Math.min(1, Math.max(0.03, shoverRange * 0.62 * f));
}
