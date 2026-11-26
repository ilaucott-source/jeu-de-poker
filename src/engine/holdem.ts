import { type Card, createRng, fullDeck, shuffle } from './cards';
import { evaluateBest, evaluateOmaha, type HandValue } from './evaluator';
import { value27 } from './lowball';

/** NL = No Limit, PL = Pot Limit, FL = Limit (Fixed Limit). */
export type BettingStructure = 'NL' | 'PL' | 'FL';
export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'draw';

export interface SeatInput {
  id: string;
  name: string;
  stack: number;
}

export interface PlayerState {
  id: string;
  name: string;
  seat: number;
  /** Jetons devant le joueur (hors mises en cours). */
  stack: number;
  /** Mise sur le tour d'enchères en cours. */
  bet: number;
  /** Total investi dans la main (antes, blinds, mises). */
  committed: number;
  holeCards: Card[];
  folded: boolean;
  allIn: boolean;
  /** A parlé depuis la dernière relance (ou le début du tour). */
  hasActed: boolean;
  /** Niveau de relance complète auquel le joueur a parlé pour la dernière fois (-1 = pas encore). */
  actedAtLevel: number;
  /** Ne participe pas à la main (tapis vide). */
  out: boolean;
}

export interface Action {
  playerId: string;
  type: ActionType | 'post';
  /** Pour bet/raise : montant total de la mise sur ce tour ("relance à"). Pour post/call : montant ajouté. */
  amount: number;
  street: Street;
  allIn?: boolean;
  label?: string;
  /** 2-7 : positions des cartes jetées */
  discard?: number[];
}

export interface Pot {
  amount: number;
  eligible: string[];
}

export interface PotResult {
  amount: number;
  winners: string[];
  /** Montant gagné par joueur dans ce pot. */
  shares: Record<string, number>;
  hand?: string;
}

/** Jeu : Texas Hold'em (2 cartes), Omaha (4 cartes, on en utilise exactement 2) ou 2-7 Triple Draw (5 cartes, trois tirages, la plus basse gagne). */
export type GameVariant = 'holdem' | 'omaha' | 'draw27';

export interface HandConfig {
  /** absent = Texas Hold'em (anciennes parties) */
  variant?: GameVariant;
  structure: BettingStructure;
  smallBlind: number;
  bigBlind: number;
  /** Ante par joueur (0 si aucune). */
  ante?: number;
  /** Index (dans seats) du bouton du donneur. */
  buttonIndex: number;
  seed: number;
  /** Nombre maximum de mises par tour en Limit (mise + relances). */
  limitCap?: number;
  /** Tournoi : répartition des gains (parts du prix total, 1re place en premier). Absent en cash game. */
  tourney?: { payouts: number[] };
  /** Paquet imposé (sinon il est mélangé avec la graine) : sert à rejouer une main en ligne sans révéler les cartes cachées. */
  deck?: Card[];
}

export interface HandState {
  config: HandConfig;
  players: PlayerState[];
  street: Street;
  board: Card[];
  deck: Card[];
  /** Index du joueur qui doit parler, ou null. */
  toAct: number | null;
  currentBet: number;
  /** Taille de la dernière relance complète (minimum pour relancer). */
  minRaise: number;
  /** Incrémenté à chaque relance complète : sert à savoir qui peut encore relancer. */
  fullRaiseLevel: number;
  betsThisStreet: number;
  sbIndex: number;
  bbIndex: number;
  log: Action[];
  results: PotResult[] | null;
  /** Mains montrées à l'abattage. */
  showdown: Record<string, HandValue> | null;
  /** 2-7 : joueurs qui doivent encore choisir leurs cartes à changer (dans l'ordre), ou null hors tirage */
  drawPending?: number[] | null;
  /** 2-7 : cartes jetées (remélangées si le paquet est vide) */
  discards?: Card[];
  /** 2-7 : nombre de fois où les cartes jetées ont été remélangées */
  reshuffles?: number;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  /** Montant à ajouter pour suivre (0 si check possible). */
  callAmount: number;
  canBetOrRaise: boolean;
  /** "Relance à" minimum et maximum (total de la mise sur ce tour). */
  minTo: number;
  maxTo: number;
  isBet: boolean;
}

const clone = <T>(v: T): T => structuredClone(v);

function nextIndex(players: PlayerState[], from: number, pred: (p: PlayerState) => boolean): number {
  const n = players.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (pred(players[i])) return i;
  }
  return -1;
}

const inHand = (p: PlayerState) => !p.out && !p.folded;
const canAct = (p: PlayerState) => inHand(p) && !p.allIn;

export function potTotal(state: HandState): number {
  return state.players.reduce((s, p) => s + p.committed, 0);
}

function betUnit(state: HandState): number {
  const { bigBlind } = state.config;
  return state.street === 'turn' || state.street === 'river' ? bigBlind * 2 : bigBlind;
}

function putChips(state: HandState, idx: number, amount: number): number {
  const p = state.players[idx];
  const a = Math.min(amount, p.stack);
  p.stack -= a;
  p.bet += a;
  p.committed += a;
  if (p.stack === 0) p.allIn = true;
  return a;
}

/** Démarre une nouvelle main : antes, blinds, distribution. */
export function startHand(seats: SeatInput[], config: HandConfig): HandState {
  const players: PlayerState[] = seats.map((s, i) => ({
    id: s.id,
    name: s.name,
    seat: i,
    stack: s.stack,
    bet: 0,
    committed: 0,
    holeCards: [],
    folded: false,
    allIn: false,
    hasActed: false,
    actedAtLevel: -1,
    out: s.stack <= 0,
  }));
  const live = players.filter((p) => !p.out);
  if (live.length < 2) throw new Error('Il faut au moins deux joueurs avec des jetons');

  const rng = createRng(config.seed);
  const deck = config.deck ? [...config.deck] : shuffle(fullDeck(), rng);

  let button = config.buttonIndex;
  if (players[button].out) button = nextIndex(players, button, (p) => !p.out);

  const headsUp = live.length === 2;
  const sbIndex = headsUp ? button : nextIndex(players, button, (p) => !p.out);
  const bbIndex = nextIndex(players, sbIndex, (p) => !p.out);

  const state: HandState = {
    config: { ...config, buttonIndex: button },
    players,
    street: 'preflop',
    board: [],
    deck,
    toAct: null,
    currentBet: 0,
    minRaise: config.bigBlind,
    fullRaiseLevel: 0,
    betsThisStreet: 1,
    sbIndex,
    bbIndex,
    log: [],
    results: null,
    showdown: null,
  };

  const ante = config.ante ?? 0;
  if (ante > 0) {
    players.forEach((p, i) => {
      if (p.out) return;
      const a = putChips(state, i, ante);
      p.bet -= a; // l'ante est une mise morte : elle ne compte pas dans la mise du tour
      state.log.push({ playerId: p.id, type: 'post', amount: a, street: 'preflop', label: 'ante', allIn: p.allIn });
    });
  }
  const sb = putChips(state, sbIndex, config.smallBlind);
  state.log.push({ playerId: players[sbIndex].id, type: 'post', amount: sb, street: 'preflop', label: 'petite blind', allIn: players[sbIndex].allIn });
  const bb = putChips(state, bbIndex, config.bigBlind);
  state.log.push({ playerId: players[bbIndex].id, type: 'post', amount: bb, street: 'preflop', label: 'grosse blind', allIn: players[bbIndex].allIn });
  state.currentBet = Math.max(config.bigBlind, ...players.map((p) => p.bet));

  // Distribution : deux cartes chacun (quatre à l'Omaha), en commençant à gauche du bouton
  const holeCount = config.variant === 'draw27' ? 5 : config.variant === 'omaha' ? 4 : 2;
  for (let round = 0; round < holeCount; round++) {
    let i = sbIndex;
    for (let k = 0; k < live.length; k++) {
      players[i].holeCards.push(state.deck.shift()!);
      i = nextIndex(players, i, (p) => !p.out);
    }
  }

  state.toAct = nextIndex(players, bbIndex, canAct);
  if (state.toAct === -1) state.toAct = null;
  return settle(state);
}

export function legalActions(state: HandState): LegalActions | null {
  if (state.toAct === null || state.drawPending?.length) return null;
  const p = state.players[state.toAct];
  const callAmount = Math.min(state.currentBet - p.bet, p.stack);
  const canCheck = state.currentBet === p.bet;
  const maxPossible = p.bet + p.stack;
  const reopened = p.actedAtLevel !== state.fullRaiseLevel;
  const othersCanRespond = state.players.some((o, i) => i !== state.toAct && canAct(o));
  // On ne peut pas relancer si tout le monde est déjà à tapis (ou si l'action n'est pas rouverte)
  let canBetOrRaise = reopened && othersCanRespond && maxPossible > state.currentBet;

  let minTo = 0;
  let maxTo = 0;
  const { structure } = state.config;
  if (structure === 'FL') {
    const cap = state.config.limitCap ?? 4;
    if (state.betsThisStreet >= cap) canBetOrRaise = false;
    minTo = maxTo = Math.min(state.currentBet + betUnit(state), maxPossible);
  } else {
    minTo = Math.min(state.currentBet + state.minRaise, maxPossible);
    if (structure === 'NL') maxTo = maxPossible;
    else {
      const toCall = state.currentBet - p.bet;
      const potAfterCall = potTotal(state) + toCall;
      maxTo = Math.min(state.currentBet + potAfterCall, maxPossible);
    }
    if (maxTo < minTo) minTo = maxTo;
  }
  return {
    canFold: !canCheck,
    canCheck,
    callAmount: canCheck ? 0 : callAmount,
    canBetOrRaise,
    minTo,
    maxTo,
    isBet: state.currentBet === 0,
  };
}

export type PlayerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet' | 'raise'; to: number }
  /** 2-7 : jeter les cartes à ces positions (liste vide = servi) */
  | { type: 'draw'; discard: number[] };

/** 2-7 : c'est au tour de ce joueur de changer ses cartes. */
export const isDrawing = (s: HandState) => !!s.drawPending?.length && s.toAct !== null;

function applyDraw(prev: HandState, discard: number[]): HandState {
  const state = clone(prev);
  const idx = state.toAct!;
  const p = state.players[idx];
  const set = [...new Set(discard)].filter((i) => i >= 0 && i < p.holeCards.length).sort((a, b) => a - b);
  state.discards ??= [];
  const thrown = set.map((i) => p.holeCards[i]);
  for (const i of set) {
    if (!state.deck.length) {
      // paquet vide : on remélange les cartes jetées par les autres (pas celles qu'on vient de jeter)
      state.reshuffles = (state.reshuffles ?? 0) + 1;
      state.deck = shuffle(state.discards, createRng((state.config.seed ^ (0x9e3779b9 * state.reshuffles)) >>> 0));
      state.discards = [];
    }
    p.holeCards[i] = state.deck.shift()!;
  }
  state.discards.push(...thrown);
  state.log.push({ playerId: p.id, type: 'draw', amount: set.length, street: state.street, discard: set });
  state.drawPending = state.drawPending!.slice(1);
  if (state.drawPending.length) state.toAct = state.drawPending[0];
  else {
    state.drawPending = null;
    const first = nextIndex(state.players, state.config.buttonIndex, canAct);
    state.toAct = first === -1 ? null : first;
  }
  return settle(state);
}

/** Applique une action du joueur dont c'est le tour. Renvoie un nouvel état (l'ancien n'est pas modifié). */
export function applyAction(prev: HandState, action: PlayerAction): HandState {
  if (prev.drawPending?.length) {
    if (action.type !== 'draw') throw new Error('Il faut choisir les cartes à changer');
    return applyDraw(prev, action.discard);
  }
  if (action.type === 'draw') throw new Error('Pas de tirage en ce moment');
  const legal = legalActions(prev);
  if (!legal || prev.toAct === null) throw new Error("Ce n'est le tour de personne");
  const state = clone(prev);
  const idx = state.toAct!;
  const p = state.players[idx];
  const street = state.street;

  switch (action.type) {
    case 'fold':
      if (legal.canCheck) throw new Error('Inutile de se coucher : check possible');
      p.folded = true;
      state.log.push({ playerId: p.id, type: 'fold', amount: 0, street });
      break;
    case 'check':
      if (!legal.canCheck) throw new Error('Check impossible : il y a une mise à suivre');
      state.log.push({ playerId: p.id, type: 'check', amount: 0, street });
      break;
    case 'call': {
      if (legal.canCheck) throw new Error('Rien à suivre');
      const added = putChips(state, idx, legal.callAmount);
      state.log.push({ playerId: p.id, type: 'call', amount: added, street, allIn: p.allIn });
      break;
    }
    case 'bet':
    case 'raise': {
      if (!legal.canBetOrRaise) throw new Error('Relance impossible');
      const maxPossible = p.bet + p.stack;
      let to = Math.round(action.to);
      if (to > legal.maxTo) throw new Error(`Maximum : ${legal.maxTo}`);
      if (to < legal.minTo && to !== maxPossible) throw new Error(`Minimum : ${legal.minTo}`);
      to = Math.min(to, maxPossible);
      const raiseSize = to - state.currentBet;
      putChips(state, idx, to - p.bet);
      const full = state.config.structure === 'FL' ? raiseSize >= betUnit(state) : raiseSize >= state.minRaise;
      if (full) {
        state.minRaise = raiseSize;
        state.fullRaiseLevel++;
        state.betsThisStreet++;
      }
      state.currentBet = to;
      // Tout le monde doit à nouveau parler
      state.players.forEach((o, i) => {
        if (i !== idx) o.hasActed = false;
      });
      state.log.push({
        playerId: p.id,
        type: state.log.some((a) => a.street === street && (a.type === 'bet' || a.type === 'raise')) || street === 'preflop' ? 'raise' : 'bet',
        amount: to,
        street,
        allIn: p.allIn,
      });
      break;
    }
  }
  p.hasActed = true;
  p.actedAtLevel = state.fullRaiseLevel;
  state.toAct = nextIndex(state.players, idx, canAct);
  return settle(state);
}

function roundComplete(state: HandState): boolean {
  const actors = state.players.filter(canAct);
  return actors.every((p) => p.hasActed && p.bet === state.currentBet) ||
    (actors.length === 1 && actors[0].bet >= state.currentBet && state.players.filter(inHand).length > 1 && actors[0].hasActed) ||
    actors.length === 0;
}

/** Fait avancer la main tant qu'aucune décision n'est requise. */
function settle(state: HandState): HandState {
  for (;;) {
    const remaining = state.players.filter(inHand);
    if (remaining.length === 1) return finishByFold(state, remaining[0]);
    if (state.drawPending?.length) return state;

    const actors = state.players.filter(canAct);
    // Un seul joueur peut encore agir et il a déjà égalisé : personne d'autre ne peut répondre
    const lone = actors.length === 1 && actors[0].bet >= state.currentBet;
    if (!roundComplete(state) && !lone) {
      if (state.toAct === null || state.toAct === -1 || !canAct(state.players[state.toAct])) {
        state.toAct = nextIndex(state.players, state.toAct ?? state.config.buttonIndex, canAct);
      }
      return state;
    }
    if (state.street === 'river') return showdown(state);
    nextStreet(state);
  }
}

function nextStreet(state: HandState) {
  for (const p of state.players) {
    p.bet = 0;
    p.hasActed = false;
    p.actedAtLevel = -1;
  }
  state.currentBet = 0;
  state.minRaise = state.config.bigBlind;
  state.fullRaiseLevel = 0;
  state.betsThisStreet = 0;
  if (state.config.variant === 'draw27') {
    // 2-7 : pas de tableau ; chaque joueur encore en jeu change ses cartes, en commençant à gauche du bouton
    state.street = state.street === 'preflop' ? 'flop' : state.street === 'flop' ? 'turn' : 'river';
    const order: number[] = [];
    const n = state.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (state.config.buttonIndex + k) % n;
      if (inHand(state.players[i])) order.push(i);
    }
    state.drawPending = order;
    state.toAct = order[0] ?? null;
    return;
  }
  state.deck.shift(); // carte brûlée
  if (state.street === 'preflop') {
    state.street = 'flop';
    state.board.push(state.deck.shift()!, state.deck.shift()!, state.deck.shift()!);
  } else if (state.street === 'flop') {
    state.street = 'turn';
    state.board.push(state.deck.shift()!);
  } else {
    state.street = 'river';
    state.board.push(state.deck.shift()!);
  }
  const first = nextIndex(state.players, state.config.buttonIndex, canAct);
  state.toAct = first === -1 ? null : first;
}

function finishByFold(state: HandState, winner: PlayerState): HandState {
  const amount = potTotal(state);
  winner.stack += amount;
  state.results = [{ amount, winners: [winner.id], shares: { [winner.id]: amount } }];
  for (const p of state.players) {
    p.bet = 0;
    p.committed = 0;
  }
  state.street = 'complete';
  state.toAct = null;
  return state;
}

/** Découpe le pot en pot principal et pots secondaires. */
export function buildPots(players: PlayerState[]): Pot[] {
  const levels = [...new Set(players.filter((p) => p.committed > 0).map((p) => p.committed))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    const contributors = players.filter((p) => p.committed >= level);
    const amount = contributors.length * (level - prev) +
      players.filter((p) => p.committed > prev && p.committed < level).reduce((s, p) => s + (p.committed - prev), 0);
    const eligible = players.filter((p) => inHand(p) && p.committed >= level).map((p) => p.id);
    if (eligible.length === 0 && pots.length > 0) pots[pots.length - 1].amount += amount;
    else if (pots.length > 0 && sameSet(pots[pots.length - 1].eligible, eligible)) pots[pots.length - 1].amount += amount;
    else pots.push({ amount, eligible });
    prev = level;
  }
  return pots;
}

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function showdown(state: HandState): HandState {
  const draw = state.config.variant === 'draw27';
  while (!draw && state.board.length < 5) {
    state.deck.shift();
    state.board.push(state.deck.shift()!);
  }
  state.street = 'showdown';
  const values: Record<string, HandValue> = {};
  const omaha = state.config.variant === 'omaha';
  for (const p of state.players.filter(inHand))
    values[p.id] = draw ? value27(p.holeCards) : omaha ? evaluateOmaha(p.holeCards, state.board) : evaluateBest([...p.holeCards, ...state.board]);
  state.showdown = values;

  const pots = buildPots(state.players);
  const results: PotResult[] = [];
  const n = state.players.length;
  for (const pot of pots) {
    const best = Math.max(...pot.eligible.map((id) => values[id].score));
    const winners = pot.eligible.filter((id) => values[id].score === best);
    // Jetons indivisibles : au premier gagnant à gauche du bouton
    const ordered: string[] = [];
    for (let k = 1; k <= n; k++) {
      const pl = state.players[(state.config.buttonIndex + k) % n];
      if (winners.includes(pl.id)) ordered.push(pl.id);
    }
    const share = Math.floor(pot.amount / winners.length);
    let rest = pot.amount - share * winners.length;
    const shares: Record<string, number> = {};
    for (const id of ordered) {
      shares[id] = share + (rest > 0 ? 1 : 0);
      if (rest > 0) rest--;
      state.players.find((p) => p.id === id)!.stack += shares[id];
    }
    results.push({ amount: pot.amount, winners: ordered, shares, hand: undefined });
  }
  state.results = results;
  for (const p of state.players) {
    p.bet = 0;
    p.committed = 0;
  }
  state.street = 'complete';
  state.toAct = null;
  return state;
}

export function stacksAfter(state: HandState): SeatInput[] {
  return state.players.map((p) => ({ id: p.id, name: p.name, stack: p.stack }));
}
