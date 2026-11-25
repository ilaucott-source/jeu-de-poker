import type { HandScript } from '../engine/analysis';
import type { HandState, SeatInput } from '../engine/holdem';
import type { CashGameOptions, Elimination } from './useCashGame';

/** Partie en cours, sauvegardée en continu pour pouvoir la reprendre (ici ou sur un autre appareil). */
export interface SavedGame {
  v: 1;
  ts: number;
  opts: CashGameOptions;
  seats: SeatInput[];
  button: number;
  handNo: number;
  eliminated: Elimination[];
  hand: HandState | null;
  script: Omit<HandScript, 'actions'> | null;
  over?: boolean;
}

const KEY = 'poker-save';
type Listener = (g: SavedGame | null) => void;
const listeners = new Set<Listener>();
export const onSaveChange = (l: Listener) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function loadGame(): SavedGame | null {
  try {
    const g = JSON.parse(localStorage.getItem(KEY) ?? 'null') as SavedGame | null;
    return g && g.v === 1 && !g.over ? g : null;
  } catch {
    return null;
  }
}
export function saveGame(g: SavedGame) {
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    /* mémoire pleine */
  }
  listeners.forEach((l) => l(g));
}
export function clearGame() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* rien */
  }
  listeners.forEach((l) => l(null));
}
