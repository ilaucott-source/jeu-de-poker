import { useCallback, useEffect, useRef, useState } from 'react';
import { BOT_STYLES, pickBots, styleFor, type BotLevel } from '../engine/bots';
import type { TimerPreset } from './timer';
import { applyAction, startHand, stacksAfter, type BettingStructure, type HandState, type PlayerAction, type SeatInput } from '../engine/holdem';
import { styledBot } from '../engine/bots';
import { clearGame, saveGame, type SavedGame } from './save';
import { thinkTime, type BotPace } from '../engine/thinking';
import { analyzeHand, type HandScript } from '../engine/analysis';
import { recordFromHand, saveHand, saveTourney, updateHand } from './history';
import { LEVEL_FR } from '../engine/bots';
import { BLIND_LEVELS, levelFor, SPEED, TOURNEY_STACK, type TourneySpeed } from './tournament';

export const HERO_ID = 'hero';
export const BOTS = BOT_STYLES.map((b) => ({ name: b.name, avatar: b.avatar }));
export const avatarFor = (name: string) => {
  const b = BOTS.find((x) => x.name === name);
  return b ? `./img/avatars/${b.avatar}.webp` : null;
};

export type GameMode = 'cash' | 'tournament';

export interface CashGameOptions {
  mode: GameMode;
  structure: BettingStructure;
  bigBlind: number;
  /** Tapis de départ en grosses blinds (cash game). */
  buyInBB: number;
  bots: number;
  level: BotLevel | 'mix';
  speed: TourneySpeed;
  /** rythme de jeu des adversaires */
  pace?: BotPace;
  timer: TimerPreset;
}

export interface Elimination {
  id: string;
  name: string;
  place: number;
}

export function useCashGame(opts: CashGameOptions, resume?: SavedGame | null) {
  const tourney = opts.mode === 'tournament';
  const [hand, setHand] = useState<HandState | null>(resume?.hand ?? null);
  const [handNo, setHandNo] = useState(resume?.handNo ?? 0);
  const handNoRef = useRef(resume?.handNo ?? 0);
  const scriptRef = useRef<Omit<HandScript, 'actions'> | null>(resume?.script ?? null);
  const savedRef = useRef(resume?.hand?.street === 'complete' ? resume.handNo : 0);
  const [lastRecordId, setLastRecordId] = useState<string | null>(null);
  const [eliminated, setEliminated] = useState<Elimination[]>(resume?.eliminated ?? []);
  const startStack = tourney ? TOURNEY_STACK : opts.buyInBB * opts.bigBlind;
  const botsRef = useRef(
    resume ? resume.seats.filter((x) => x.id !== HERO_ID).map((x) => styleFor(x.name) ?? BOT_STYLES[0]) : pickBots(opts.level, opts.bots),
  );
  const seatsRef = useRef<SeatInput[]>(
    resume?.seats ?? [
      { id: HERO_ID, name: 'Toi', stack: startStack },
      ...botsRef.current.map((b, i) => ({ id: `bot${i}`, name: b.name, stack: startStack })),
    ],
  );
  const buttonRef = useRef(resume?.button ?? Math.floor(Math.random() * (opts.bots + 1)));
  const total = opts.bots + 1;

  const nextLevel = tourney ? levelFor(handNo + 1, opts.speed) : 0;
  const level = tourney ? BLIND_LEVELS[levelFor(Math.max(1, handNo), opts.speed)] : { sb: opts.bigBlind / 2, bb: opts.bigBlind, ante: 0 };
  const handsLeftInLevel = tourney ? SPEED[opts.speed].handsPerLevel - ((Math.max(1, handNo) - 1) % SPEED[opts.speed].handsPerLevel) - 1 : 0;

  const deal = useCallback(() => {
    if (!tourney) {
      // En cash game, un bot à court de jetons se recave automatiquement
      seatsRef.current = seatsRef.current.map((s) =>
        s.id !== HERO_ID && s.stack < opts.bigBlind * 10 ? { ...s, stack: opts.buyInBB * opts.bigBlind } : s,
      );
    }
    const n = seatsRef.current.length;
    // le bouton avance jusqu'au prochain joueur encore en jeu
    let b = buttonRef.current;
    for (let k = 0; k < n; k++) {
      b = (b + 1) % n;
      if (seatsRef.current[b].stack > 0) break;
    }
    buttonRef.current = b;
    const no = handNoRef.current + 1;
    handNoRef.current = no;
    const lv = tourney ? BLIND_LEVELS[levelFor(no, opts.speed)] : { sb: opts.bigBlind / 2, bb: opts.bigBlind, ante: 0 };
    const config = {
      structure: opts.structure,
      smallBlind: lv.sb,
      bigBlind: lv.bb,
      ante: lv.ante || undefined,
      buttonIndex: b,
      seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0,
    };
    scriptRef.current = { seats: seatsRef.current.map((x) => ({ ...x })), config };
    setHand(startHand(seatsRef.current, config));
    setHandNo(no);
  }, [opts.bigBlind, opts.buyInBB, opts.structure, opts.speed, tourney]);

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
    const style = styleFor(p.name) ?? BOT_STYLES[0];
    // le bot décide tout de suite, puis « réfléchit » un temps qui dépend de la difficulté du coup
    const action = styledBot(hand, style);
    const delay = thinkTime(hand, style, action, opts.pace ?? 'normal');
    const logLen = hand.log.length;
    const t = setTimeout(() => setHand((h) => (h && h.toAct !== null && h.players[h.toAct].id === p.id && h.log.length === logLen ? applyAction(h, action) : h)), delay);
    return () => clearTimeout(t);
  }, [hand]);

  useEffect(() => {
    if (hand?.street !== 'complete') return;
    const before = new Map((scriptRef.current?.seats ?? []).map((p) => [p.id, p.stack]));
    seatsRef.current = stacksAfter(hand);
    // historique et analyse de la main (une seule fois par main)
    if (scriptRef.current && savedRef.current !== handNoRef.current) {
      savedRef.current = handNoRef.current;
      const rec = recordFromHand(hand, scriptRef.current, HERO_ID, opts.mode);
      if (rec) {
        saveHand(rec);
        setLastRecordId(rec.id);
        setTimeout(() => {
          try {
            updateHand(rec.id, { decisions: analyzeHand(rec.script, HERO_ID) });
          } catch {
            /* analyse impossible : la main reste dans l'historique */
          }
        }, 50);
      }
    }
    if (!tourney) return;
    // éliminations : le joueur qui avait le plus de jetons au début de la main finit devant
    const busted = hand.players.filter((p) => !p.out && seatsRef.current.find((s) => s.id === p.id)!.stack <= 0);
    if (!busted.length) return;
    setEliminated((prev) => {
      if (busted.every((b) => prev.some((e) => e.id === b.id))) return prev;
      const remaining = total - prev.length;
      const sorted = [...busted].sort((a, b) => before.get(a.id)! - before.get(b.id)!);
      return [...prev, ...sorted.map((p, k) => ({ id: p.id, name: p.name, place: remaining - k }))];
    });
  }, [hand, tourney, total]);

  // sauvegarde continue de la partie, pour la reprendre plus tard ou ailleurs
  useEffect(() => {
    if (!hand) return;
    const t = setTimeout(() => {
      const over = tourney && (total - eliminated.length <= 1 || eliminated.some((e) => e.id === HERO_ID));
      if (over) clearGame();
      else
        saveGame({ v: 1, ts: Date.now(), opts, seats: seatsRef.current, button: buttonRef.current, handNo: handNoRef.current, eliminated, hand, script: scriptRef.current });
    }, 300);
    return () => clearTimeout(t);
  }, [hand, eliminated, opts, tourney, total]);

  const heroStack = seatsRef.current.find((s) => s.id === HERO_ID)!.stack;
  const alive = total - eliminated.length;
  const heroOut = eliminated.find((e) => e.id === HERO_ID);
  const tourneyOver = tourney && (alive <= 1 || !!heroOut);
  const heroPlace = heroOut ? heroOut.place : alive <= 1 ? 1 : null;
  const tourneySaved = useRef(false);
  useEffect(() => {
    if (!tourneyOver || !heroPlace || tourneySaved.current) return;
    tourneySaved.current = true;
    saveTourney({ ts: Date.now(), place: heroPlace, players: total, hands: handNoRef.current, level: LEVEL_FR[opts.level] });
  }, [tourneyOver, heroPlace, total, opts.level]);

  return {
    hand,
    handNo,
    deal,
    act,
    rebuy,
    heroStack,
    bots: botsRef.current,
    level,
    levelIndex: tourney ? levelFor(Math.max(1, handNo), opts.speed) : 0,
    nextLevel,
    handsLeftInLevel,
    eliminated,
    alive,
    total,
    tourneyOver,
    heroPlace,
    lastRecordId,
  };
}
