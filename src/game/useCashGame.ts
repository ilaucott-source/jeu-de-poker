import { useCallback, useEffect, useRef, useState } from 'react';
import { simpleBot } from '../engine/bot';
import type { TimerPreset } from './timer';
import { applyAction, startHand, stacksAfter, type BettingStructure, type HandState, type PlayerAction, type SeatInput } from '../engine/holdem';

export const HERO_ID = 'hero';
export const BOTS = [
  { name: 'Le Débutant', avatar: 'debutant' },
  { name: 'La Prudente', avatar: 'prudente' },
  { name: 'Le Fêtard', avatar: 'fetard' },
  { name: 'La Calculatrice', avatar: 'calculatrice' },
  { name: 'Le Cow-boy', avatar: 'cowboy' },
  { name: 'Le Requin', avatar: 'requin' },
  { name: 'La Pro', avatar: 'pro' },
  { name: 'Le Mystère', avatar: 'mystere' },
  { name: 'Le Vétéran', avatar: 'veteran' },
];
const BOT_NAMES = BOTS.map((b) => b.name);
export const avatarFor = (name: string) => {
  const b = BOTS.find((x) => x.name === name);
  return b ? `./img/avatars/${b.avatar}.webp` : null;
};

export interface CashGameOptions {
  structure: BettingStructure;
  bigBlind: number;
  /** Tapis de départ en grosses blinds. */
  buyInBB: number;
  bots: number;
  timer: TimerPreset;
}

export function useCashGame(opts: CashGameOptions) {
  const [hand, setHand] = useState<HandState | null>(null);
  const [handNo, setHandNo] = useState(0);
  const seatsRef = useRef<SeatInput[]>([
    { id: HERO_ID, name: 'Toi', stack: opts.buyInBB * opts.bigBlind },
    ...BOT_NAMES.slice(0, opts.bots).map((name, i) => ({ id: `bot${i}`, name, stack: opts.buyInBB * opts.bigBlind })),
  ]);
  const buttonRef = useRef(Math.floor(Math.random() * (opts.bots + 1)));

  const deal = useCallback(() => {
    // En cash game, un bot à court de jetons se recave automatiquement
    seatsRef.current = seatsRef.current.map((s) =>
      s.id !== HERO_ID && s.stack < opts.bigBlind * 10 ? { ...s, stack: opts.buyInBB * opts.bigBlind } : s,
    );
    const n = seatsRef.current.length;
    buttonRef.current = (buttonRef.current + 1) % n;
    const h = startHand(seatsRef.current, {
      structure: opts.structure,
      smallBlind: opts.bigBlind / 2,
      bigBlind: opts.bigBlind,
      buttonIndex: buttonRef.current,
      seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0,
    });
    setHand(h);
    setHandNo((x) => x + 1);
  }, [opts.bigBlind, opts.buyInBB, opts.structure]);

  const act = useCallback((a: PlayerAction) => {
    setHand((h) => (h ? applyAction(h, a) : h));
  }, []);

  const rebuy = useCallback(() => {
    seatsRef.current = seatsRef.current.map((s) => (s.id === HERO_ID ? { ...s, stack: opts.buyInBB * opts.bigBlind } : s));
  }, [opts.bigBlind, opts.buyInBB]);

  // Les bots jouent avec un petit délai pour que l'action reste lisible
  useEffect(() => {
    if (!hand || hand.toAct === null) return;
    const p = hand.players[hand.toAct];
    if (p.id === HERO_ID) return;
    const t = setTimeout(() => setHand((h) => (h && h.toAct !== null ? applyAction(h, simpleBot(h)) : h)), 700 + Math.random() * 600);
    return () => clearTimeout(t);
  }, [hand]);

  useEffect(() => {
    if (hand?.street === 'complete') seatsRef.current = stacksAfter(hand);
  }, [hand]);

  return { hand, handNo, deal, act, rebuy, heroStack: seatsRef.current.find((s) => s.id === HERO_ID)!.stack };
}
