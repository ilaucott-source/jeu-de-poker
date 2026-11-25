/// <reference lib="webworker" />
import type { Card } from './cards';
import { equity } from './odds';
import { equityVsRanges, type RangeSpec } from './ranges';
import { omahaEquityVsRanges } from './omaha';

export interface EquityJob {
  id: number;
  hole: Card[];
  board: Card[];
  ranges: RangeSpec[];
  omaha?: boolean;
}
export interface EquityResult {
  id: number;
  random: number;
  vsRange: number;
}

self.onmessage = (e: MessageEvent<EquityJob>) => {
  const { id, hole, board, ranges, omaha } = e.data;
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
