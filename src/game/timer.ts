import { useEffect, useRef, useState } from 'react';

export type TimerPreset = 'off' | 'relaxed' | 'normal' | 'fast' | 'turbo';

export interface TimerSettings {
  label: string;
  /** Temps par décision, en secondes (null = pas de limite). */
  decision: number | null;
  /** Banque de temps de départ, utilisée quand le temps de décision est écoulé. */
  bank: number;
  /** Secondes rendues à la banque à chaque main jouée (sans dépasser le maximum). */
  refillPerHand: number;
  hint: string;
}

export const TIMER_PRESETS: Record<TimerPreset, TimerSettings> = {
  off: { label: 'Sans limite', decision: null, bank: 0, refillPerHand: 0, hint: 'Pour étudier tranquillement chaque décision.' },
  relaxed: { label: 'Détendu (45 s)', decision: 45, bank: 60, refillPerHand: 3, hint: 'Conseillé en cash game : le temps de réfléchir, sans traîner.' },
  normal: { label: 'Normal (25 s)', decision: 25, bank: 30, refillPerHand: 2, hint: 'Le rythme habituel des salles en ligne.' },
  fast: { label: 'Rapide (15 s)', decision: 15, bank: 20, refillPerHand: 1, hint: 'Rythme des tournois rapides.' },
  turbo: { label: 'Turbo (8 s)', decision: 8, bank: 10, refillPerHand: 1, hint: 'Pour travailler les automatismes sous pression.' },
};

/**
 * Compte à rebours pour la décision du joueur.
 * Quand le temps de décision est écoulé, la banque de temps prend le relais ;
 * quand elle est vide, onTimeout est appelé (parole si possible, sinon on se couche).
 */
export function useDecisionTimer(preset: TimerPreset, active: boolean, decisionKey: string, handNo: number, onTimeout: () => void) {
  const s = TIMER_PRESETS[preset];
  const [bank, setBank] = useState(s.bank);
  const [elapsed, setElapsed] = useState(0);
  const bankAtStart = useRef(s.bank);
  const timeoutRef = useRef(onTimeout);
  timeoutRef.current = onTimeout;

  // La banque se recharge un peu à chaque nouvelle main
  useEffect(() => {
    if (handNo > 1) setBank((b) => Math.min(s.bank, b + s.refillPerHand));
  }, [handNo, s.bank, s.refillPerHand]);

  useEffect(() => {
    setBank(s.bank);
  }, [preset, s.bank]);

  useEffect(() => {
    if (!active || s.decision === null) {
      setElapsed(0);
      return;
    }
    const start = performance.now();
    bankAtStart.current = bank;
    setElapsed(0);
    let fired = false;
    const id = setInterval(() => {
      const e = (performance.now() - start) / 1000;
      setElapsed(e);
      const over = e - s.decision!;
      if (over > 0) setBank(Math.max(0, bankAtStart.current - over));
      if (!fired && over >= bankAtStart.current) {
        fired = true;
        clearInterval(id);
        timeoutRef.current();
      }
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, decisionKey, s.decision]);

  if (s.decision === null) return { enabled: false as const };
  const remaining = Math.max(0, s.decision - elapsed);
  const usingBank = active && remaining === 0;
  return {
    enabled: true as const,
    remaining: usingBank ? bank : remaining,
    fraction: usingBank ? (bankAtStart.current ? bank / bankAtStart.current : 0) : remaining / s.decision,
    usingBank,
    bank,
    urgent: usingBank || remaining <= 5,
  };
}
