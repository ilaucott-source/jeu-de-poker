/// <reference lib="webworker" />
import type { Card } from './cards';
import { equity } from './odds';
import { equityVsRanges, type RangeSpec } from './ranges';
import { omahaEquityVsRanges } from './omaha';
import { equity27For } from './draw27';
import type { HandState } from './holdem';

export interface EquityJob {
  id: number;
  hole: Card[];
  board: Card[];
  ranges: RangeSpec[];
  omaha?: boolean;
  /** 2-7 : on simule à partir de l'état de la main (tirages adverses compris) */
  draw27?: { state: HandState; heroId: string };
}
export interface EquityResult {
  id: number;
  random: number;
  vsRange: number;
}

self.onmessage = (e: MessageEvent<EquityJob>) => {
  const { id, hole, board, ranges, omaha, draw27 } = e.data;
  if (draw27) {
    const v = equity27For(draw27.state, draw27.heroId, 1200, 13);
    (self as unknown as Worker).postMessage({ id, random: v, vsRange: v } satisfies EquityResult);
    return;
  }
  const anyHand = ranges.every((r) => (typeof r === 'number' ? r : r.top) >= 1 && (typeof r === 'number' || !r.post));
  let random: number;
  let vsRange: number;
  if (omaha) {
    const it = 700;
    random = omahaEquityVsRanges(hole, board, ranges.map(() => 1), it, 5 + board.length);
    vsRange = anyHand ? random : omahaEquityVsRanges(hole, board, ranges, it, 11 + board.length);
  } else {
    const it = board.length === 0 ? 1500 : 1200;
    random = equity(hole, board, ranges.length, it, hole.length * 97 + board.length).equity;
    vsRange = anyHand ? random : equityVsRanges(hole, board, ranges, it, 11 + board.length);
  }
  (self as unknown as Worker).postMessage({ id, random, vsRange } satisfies EquityResult);
};
