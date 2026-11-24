import { useEffect, useRef, useState } from 'react';
import type { Card } from '../engine/cards';
import type { EquityJob, EquityResult } from '../engine/equity.worker';

let worker: Worker | null = null;
let nextId = 1;
function getWorker() {
  if (!worker && typeof Worker !== 'undefined') {
    worker = new Worker(new URL('../engine/equity.worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

/** Calcule l'équité en arrière-plan, pour que l'écran reste fluide. */
export function useEquity(hole: Card[], board: Card[], ranges: number[]) {
  const key = `${hole.join('')}|${board.join('')}|${ranges.join(',')}`;
  const [res, setRes] = useState<{ key: string; random: number; vsRange: number } | null>(null);
  const want = useRef(key);
  useEffect(() => {
    want.current = key;
    if (hole.length < 2 || ranges.length === 0) return;
    const w = getWorker();
    if (!w) return;
    const id = nextId++;
    const onMsg = (e: MessageEvent<EquityResult>) => {
      if (e.data.id !== id) return;
      w.removeEventListener('message', onMsg);
      if (want.current === key) setRes({ key, random: e.data.random, vsRange: e.data.vsRange });
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ id, hole, board, ranges } satisfies EquityJob);
    return () => w.removeEventListener('message', onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return res && res.key === key ? res : null;
}
