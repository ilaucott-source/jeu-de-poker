import { createRng, fullDeck, shuffle, type Card } from '../engine/cards';
import type { HandScript } from '../engine/analysis';
import type { HandState } from '../engine/holdem';
import type { CashGameOptions, Elimination } from '../game/useCashGame';

/**
 * Jeu entre amis : l'appareil de l'hôte distribue et fait jouer les bots.
 * Il publie un état « public » (sans les cartes cachées, ni le paquet, ni la graine)
 * et envoie à chaque joueur ses propres cartes dans un document que lui seul peut lire.
 */

/** Identifiant de l'hôte dans la partie (le même que le joueur en solo). */
export const HOST_ID = 'hero';
/** Nom donné à l'hôte dans la vue des autres joueurs (leur propre siège devient 'hero'). */
export const HOST_ALIAS = 'host';

export type SeatKind = 'host' | 'human' | 'bot';

export interface OnlineSeat {
  id: string;
  name: string;
  kind: SeatKind;
  uid?: string;
  /** bot : personnage (nom du style) */
  style?: string;
  stack: number;
  /** n'a pas joué à temps : on joue pour lui (parole ou couché) jusqu'à son retour */
  away?: boolean;
  /** a quitté la table pendant une main : un bot prend sa place à la main suivante */
  leaving?: boolean;
}

export type TableStatus = 'lobby' | 'playing' | 'over';

/** Document public de la table : tables/{code}. */
export interface TableDoc {
  v: 1;
  code: string;
  host: string;
  hostName: string;
  /** appareil de l'hôte qui fait tourner la partie (une seule à la fois) */
  hostSession: string;
  createdAt: number;
  ts: number;
  /** dernier signe de vie de l'hôte */
  alive: number;
  status: TableStatus;
  opts: CashGameOptions;
  seats: OnlineSeat[];
  handNo: number;
  /** état public de la main en cours (JSON) */
  pub: string | null;
  eliminated: Elimination[];
  /** prochaine distribution automatique (ms), ou null */
  nextDealAt: number | null;
  paused: boolean;
}

/** Membre : tables/{code}/members/{uid}, écrit par le joueur lui-même. */
export interface MemberDoc {
  name: string;
  ts: number;
  left?: boolean;
}

/** Intention de jeu : tables/{code}/intents/{uid}, écrite par le joueur, lue par l'hôte. */
export interface IntentDoc {
  hand: number;
  /** longueur du journal de la main au moment de l'action (évite de jouer deux fois) */
  at: number;
  action: import('../engine/holdem').PlayerAction | null;
  /** retour à la table après une absence */
  back?: number;
  ts: number;
}

/** Cartes d'un joueur : tables/{code}/private/{uid}, écrit par l'hôte, lu par ce joueur seulement. */
export interface PrivateDoc {
  hand: number;
  cards: Card[];
  /** main terminée : de quoi l'analyser (paquet où les cartes jamais montrées sont remplacées au hasard) */
  record?: { hand: number; script: string } | null;
}

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function makeCode(rng: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(rng() * CODE_CHARS.length)];
  return s;
}
export const normalizeCode = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .slice(0, 6);
export const isCode = (s: string) => /^[A-Z0-9]{6}$/.test(s) && [...s].every((c) => CODE_CHARS.includes(c));

export const seatIdFor = (uid: string) => `u_${uid}`;

/** Fausse carte pour une carte cachée (le dos s'affiche) ; change quand la carte est remplacée au 2-7. */
const placeholder = (k: number, gen: number) => `X${k}g${gen}` as Card;
export const isHidden = (c: string) => c[0] === 'X';

/**
 * État public : cartes cachées remplacées, paquet, cartes jetées et graine retirés.
 * `viewer` garde ses propres cartes (vue locale de l'hôte).
 */
export function redact(hand: HandState, viewer: string | null = null): HandState {
  const gens = (id: string, n: number) => {
    const g = new Array(n).fill(0);
    for (const a of hand.log) if (a.playerId === id && a.type === 'draw') for (const i of a.discard ?? []) g[i]++;
    return g;
  };
  return {
    ...hand,
    config: { ...hand.config, seed: 0, deck: undefined },
    deck: [],
    discards: hand.discards ? [] : undefined,
    players: hand.players.map((p) => {
      if (p.id === viewer || hand.showdown?.[p.id]) return { ...p, holeCards: [...p.holeCards] };
      const g = gens(p.id, p.holeCards.length);
      return { ...p, holeCards: p.holeCards.map((_, k) => placeholder(k, g[k])) };
    }),
  };
}

/** Renomme les identifiants pour la vue d'un joueur : son siège devient 'hero', celui de l'hôte 'host'. */
export function makeIdMap(me: string) {
  return (id: string) => (me === HOST_ID ? id : id === me ? HOST_ID : id === HOST_ID ? HOST_ALIAS : id);
}

export function localize(pub: HandState, me: string, myCards: Card[] | null): HandState {
  const m = makeIdMap(me);
  const remapKeys = <T>(o: Record<string, T> | null | undefined) => (o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [m(k), v])) : o);
  return {
    ...pub,
    players: pub.players.map((p) => ({
      ...p,
      id: m(p.id),
      holeCards: p.id === me && myCards && myCards.length === p.holeCards.length && p.holeCards.every(isHidden) ? [...myCards] : p.holeCards,
    })),
    log: pub.log.map((a) => ({ ...a, playerId: m(a.playerId) })),
    results: pub.results ? pub.results.map((r) => ({ ...r, winners: r.winners.map(m), shares: remapKeys(r.shares)! })) : pub.results,
    showdown: remapKeys(pub.showdown) as HandState['showdown'],
  };
}

export const localizeElims = (e: Elimination[], me: string) => {
  const m = makeIdMap(me);
  return e.map((x) => ({ ...x, id: m(x.id) }));
};

/** Toutes les cartes qu'un joueur a vues pendant la main (les siennes, tirages compris, le tableau, les mains montrées). */
function seenBy(script: HandScript, states: HandState[], viewer: string): Set<string> {
  const seen = new Set<string>();
  const final = states[states.length - 1];
  for (const st of states) {
    const me = st.players.find((p) => p.id === viewer);
    me?.holeCards.forEach((c) => seen.add(c));
  }
  final.board.forEach((c) => seen.add(c));
  if (final.showdown) for (const p of final.players) if (final.showdown[p.id]) p.holeCards.forEach((c) => seen.add(c));
  void script;
  return seen;
}

/**
 * Script d'une main terminée, à transmettre à un joueur pour son historique et l'analyse :
 * on remplace le paquet par un paquet où toutes les cartes qu'il n'a jamais vues sont mélangées au hasard,
 * puis on renomme les sièges pour sa vue. Rejouer ce script redonne exactement ce qu'il a vu, sans rien de plus.
 * Renvoie null si la main ne peut pas être reproduite ainsi (2-7 avec cartes jetées remélangées).
 */
export function scriptFor(script: HandScript, states: HandState[], viewer: string, rng: () => number = Math.random): HandScript | null {
  const final = states[states.length - 1];
  if (final.reshuffles) return null;
  const seen = seenBy(script, states, viewer);
  const real = script.config.deck ?? shuffle(fullDeck(), createRng(script.config.seed));
  const hiddenPos: number[] = [];
  real.forEach((c, i) => {
    if (!seen.has(c)) hiddenPos.push(i);
  });
  const hiddenCards = shuffle(
    hiddenPos.map((i) => real[i]),
    rng,
  );
  const deck = [...real];
  hiddenPos.forEach((pos, k) => (deck[pos] = hiddenCards[k]));
  const m = makeIdMap(viewer);
  return {
    seats: script.seats.map((s) => ({ ...s, id: m(s.id) })),
    config: { ...script.config, seed: Math.floor(rng() * 2 ** 31), deck },
    actions: script.actions,
  };
}

/** Fait tourner la table pour que ce joueur soit assis en bas (index 0), comme en solo. */
export function rotateTo(hand: HandState, heroId: string): HandState {
  const n = hand.players.length;
  const r = hand.players.findIndex((p) => p.id === heroId);
  if (r <= 0) return hand;
  const ix = (i: number) => (i - r + n) % n;
  const ixN = (i: number | null) => (i === null || i < 0 ? i : ix(i));
  return {
    ...hand,
    config: { ...hand.config, buttonIndex: ix(hand.config.buttonIndex) },
    players: [...hand.players.slice(r), ...hand.players.slice(0, r)].map((p) => ({ ...p, seat: ix(p.seat) })),
    toAct: ixN(hand.toAct),
    sbIndex: ix(hand.sbIndex),
    bbIndex: ix(hand.bbIndex),
    drawPending: hand.drawPending ? hand.drawPending.map(ix) : hand.drawPending,
  };
}
