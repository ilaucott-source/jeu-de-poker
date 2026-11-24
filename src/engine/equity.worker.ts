/// <reference lib="webworker" />
import type { Card } from './cards';
import { equity } from './odds';
import { equityVsRanges } from './ranges';

export interface EquityJob {
  id: number;
  hole: Card[];
  board: Card[];
  ranges: number[];
}
export interface EquityResult {
  id: number;
  random: number;
  vsRange: number;
}

self.onmessage = (e: MessageEvent<EquityJob>) => {
  const { id, hole, board, ranges } = e.data;
  const it = board.length === 0 ? 1500 : 1200;
  const random = equity(hole, board, ranges.length, it, hole.length * 97 + board.length).equity;
  const vsRange = ranges.every((r) => r >= 1) ? random : equityVsRanges(hole, board, ranges, it, 11 + board.length);
  (self as unknown as Worker).postMessage({ id, random, vsRange } satisfies EquityResult);
};
