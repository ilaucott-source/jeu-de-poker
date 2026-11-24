import type { Card } from '../engine/cards';
import type { Decision, HandScript } from '../engine/analysis';
import { scriptActions } from '../engine/analysis';
import type { HandState } from '../engine/holdem';
import { positionOf } from '../engine/ranges';

/** Une main jouée, gardée sur l'appareil pour l'historique et les statistiques. */
export interface HandRecord {
  v: 1;
  id: string;
  ts: number;
  mode: 'cash' | 'tournament';
  script: HandScript;
  heroId: string;
  heroCards: Card[];
  heroPos: string;
  board: Card[];
  bb: number;
  /** gain ou perte du joueur, en jetons */
  net: number;
  /** joueurs dont les cartes ont été montrées */
  shown: string[];
  flags: {
    vpip: boolean;
    pfr: boolean;
    threeBetChance: boolean;
    threeBet: boolean;
    sawFlop: boolean;
    showdown: boolean;
    wonShowdown: boolean;
    /** mises et relances après le flop */
    aggr: number;
    /** calls après le flop */
    calls: number;
  };
  decisions?: Decision[];
}

export interface TourneyRecord {
  ts: number;
  place: number;
  players: number;
  hands: number;
  level: string;
}

const HANDS_KEY = 'poker-history';
const TOURNEY_KEY = 'poker-tourneys';
const MAX_HANDS = 600;

function read<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as T[];
  } catch {
    return [];
  }
}
function write<T>(key: string, list: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // mémoire pleine : on garde la moitié la plus récente
    try {
      localStorage.setItem(key, JSON.stringify(list.slice(-Math.floor(list.length / 2))));
    } catch {
      /* tant pis */
    }
  }
}

export const loadHands = () => read<HandRecord>(HANDS_KEY);
export const loadTourneys = () => read<TourneyRecord>(TOURNEY_KEY);

export function saveHand(r: HandRecord) {
  const list = loadHands().filter((x) => x.id !== r.id);
  list.push(r);
  write(HANDS_KEY, list.slice(-MAX_HANDS));
}
export function updateHand(id: string, patch: Partial<HandRecord>) {
  const list = loadHands();
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return;
  list[i] = { ...list[i], ...patch };
  write(HANDS_KEY, list);
}
export function saveTourney(t: TourneyRecord) {
  write(TOURNEY_KEY, [...loadTourneys(), t].slice(-200));
}
export function clearHistory() {
  write(HANDS_KEY, []);
  write(TOURNEY_KEY, []);
}

/** Construit l'enregistrement d'une main terminée. */
export function recordFromHand(final: HandState, script: Omit<HandScript, 'actions'>, heroId: string, mode: 'cash' | 'tournament'): HandRecord | null {
  const heroIdx = final.players.findIndex((p) => p.id === heroId);
  const hero = final.players[heroIdx];
  if (!hero || hero.out || hero.holeCards.length < 2) return null;
  const startStack = script.seats.find((s) => s.id === heroId)!.stack;
  const actions = scriptActions(final);
  const mine = final.log.filter((a) => a.playerId === heroId && a.type !== 'post');
  const pre = final.log.filter((a) => a.street === 'preflop' && a.type !== 'post');
  // 3-bet : quelqu'un a relancé avant la première action volontaire du joueur
  let raisesBeforeMe = 0;
  let threeBetChance = false;
  let threeBet = false;
  for (const a of pre) {
    if (a.playerId === heroId) {
      if (raisesBeforeMe === 1) {
        threeBetChance = true;
        threeBet = a.type === 'raise';
      }
      break;
    }
    if (a.type === 'raise') raisesBeforeMe++;
  }
  const post = mine.filter((a) => a.street !== 'preflop');
  const showdown = !!final.showdown && !hero.folded;
  const won = (final.results ?? []).some((r) => (r.shares[heroId] ?? 0) > 0);
  return {
    v: 1,
    id: `${Date.now().toString(36)}-${final.config.seed.toString(36)}`,
    ts: Date.now(),
    mode,
    script: { ...script, actions },
    heroId,
    heroCards: hero.holeCards,
    heroPos: positionOf({ ...final }, heroIdx),
    board: final.board,
    bb: final.config.bigBlind,
    net: hero.stack - startStack,
    shown: final.showdown ? Object.keys(final.showdown) : [],
    flags: {
      vpip: mine.some((a) => a.street === 'preflop' && (a.type === 'call' || a.type === 'raise')),
      pfr: mine.some((a) => a.street === 'preflop' && a.type === 'raise'),
      threeBetChance,
      threeBet,
      sawFlop: final.board.length >= 3 && !mine.some((a) => a.street === 'preflop' && a.type === 'fold'),
      showdown,
      wonShowdown: showdown && won,
      aggr: post.filter((a) => a.type === 'bet' || a.type === 'raise').length,
      calls: post.filter((a) => a.type === 'call').length,
    },
  };
}
