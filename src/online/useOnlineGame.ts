import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PlayerAction } from '../engine/holdem';
import { analyzeHand, ANALYSIS_VERSION } from '../engine/analysis';
import { LEVEL_FR, styleFor, BOT_STYLES } from '../engine/bots';
import { recordFromHand, saveHand, saveTourney, updateHand } from '../game/history';
import { BLIND_LEVELS, levelFor, SPEED } from '../game/tournament';
import { HERO_ID } from '../game/useCashGame';
import type { OnlineConn } from './runtime';

/** Même interface que la partie solo (useCashGame), alimentée par la table en ligne. */
export function useOnlineGame(conn: OnlineConn) {
  const snap = useSyncExternalStore(
    useCallback((cb) => conn.subscribe(cb), [conn]),
    () => conn.snapshot(),
  );
  const { opts, hand, handNo, eliminated } = snap;
  const tourney = opts.mode === 'tournament';
  const total = snap.seats.length || opts.bots + 1;

  const level = tourney ? BLIND_LEVELS[levelFor(Math.max(1, handNo), opts.speed)] : { sb: opts.bigBlind / 2, bb: opts.bigBlind, ante: 0 };
  const handsLeftInLevel = tourney ? SPEED[opts.speed].handsPerLevel - ((Math.max(1, handNo) - 1) % SPEED[opts.speed].handsPerLevel) - 1 : 0;

  // historique et analyse de la main (une seule fois par main)
  const [lastRecordId, setLastRecordId] = useState<string | null>(null);
  const savedRef = useRef(-1);
  useEffect(() => {
    if (!hand || hand.street !== 'complete' || !snap.record || snap.record.hand !== handNo || savedRef.current === handNo) return;
    savedRef.current = handNo;
    const rec = recordFromHand(hand, snap.record.script, HERO_ID, opts.mode);
    if (!rec) return;
    saveHand(rec);
    setLastRecordId(rec.id);
    setTimeout(() => {
      try {
        updateHand(rec.id, { decisions: analyzeHand(rec.script, HERO_ID), analysisV: ANALYSIS_VERSION });
      } catch {
        /* analyse impossible : la main reste dans l'historique */
      }
    }, 50);
  }, [hand, handNo, snap.record, opts.mode]);
  useEffect(() => {
    if (hand && hand.street !== 'complete') setLastRecordId(null);
  }, [hand]);

  const heroSeat = snap.seats.find((s) => s.id === HERO_ID);
  const heroStack = heroSeat?.stack ?? 0;
  const alive = total - eliminated.length;
  const heroOut = eliminated.find((e) => e.id === HERO_ID);
  const tourneyOver = tourney && (alive <= 1 || !!heroOut || snap.status === 'over');
  const heroPlace = heroOut ? heroOut.place : alive <= 1 && snap.seated ? 1 : null;
  const tourneySaved = useRef(false);
  useEffect(() => {
    if (!tourneyOver || !heroPlace || tourneySaved.current) return;
    tourneySaved.current = true;
    saveTourney({ ts: Date.now(), place: heroPlace, players: total, hands: handNo, level: LEVEL_FR[opts.level], game: opts.variant ?? 'holdem' });
  }, [tourneyOver, heroPlace, total, handNo, opts.level, opts.variant]);

  const act = useCallback((a: PlayerAction) => conn.act(a), [conn]);
  const deal = useCallback(() => conn.deal(), [conn]);

  return {
    hand,
    handNo,
    deal,
    act,
    rebuy: () => undefined,
    heroStack,
    bots: snap.seats.filter((s) => s.kind === 'bot').map((s) => styleFor(s.style ?? s.name) ?? BOT_STYLES[0]),
    level,
    levelIndex: tourney ? levelFor(Math.max(1, handNo), opts.speed) : 0,
    nextLevel: tourney ? levelFor(handNo + 1, opts.speed) : 0,
    handsLeftInLevel,
    eliminated,
    alive,
    total,
    tourneyOver,
    heroPlace,
    lastRecordId,
    snap,
  };
}
