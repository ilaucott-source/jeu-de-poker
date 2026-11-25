/** Calcule une fois pour toutes les tables d'équité préflop (npx vite-node scripts/precompute-equity.ts). */
import { writeFileSync } from 'node:fs';
import type { Card } from '../src/engine/cards';
import { equity } from '../src/engine/odds';
import { equityVsRanges, GRID_LABELS, gridName } from '../src/engine/ranges';

export const WIDTHS = [0.02, 0.035, 0.05, 0.07, 0.1, 0.13, 0.16, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.75, 1];
const IT = Number(process.env.IT ?? 3000);
const names: string[] = [];
GRID_LABELS.forEach((_, r) => GRID_LABELS.forEach((__, c) => names.push(gridName(r, c))));
const example = (n: string): Card[] => {
  const a = n[0], b = n[1];
  if (n.length === 2) return [`${a}s`, `${b}h`] as Card[];
  return n.endsWith('s') ? ([`${a}s`, `${b}s`] as Card[]) : ([`${a}s`, `${b}h`] as Card[]);
};
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const random: Record<string, number[]> = {};
const vsTop: Record<string, number[]> = {};
const t0 = Date.now();
names.forEach((n, k) => {
  const h = example(n);
  random[n] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((o) => r3(equity(h, [], o, IT, 1000 + k * 13 + o).equity));
  vsTop[n] = WIDTHS.map((w, i) => r3(equityVsRanges(h, [], [w], IT, 5000 + k * 31 + i)));
  if (k % 20 === 0) console.log(k, n, random[n][0], vsTop[n][0], ((Date.now() - t0) / 1000).toFixed(0) + 's');
});
writeFileSync('src/engine/preflopEquity.json', JSON.stringify({ widths: WIDTHS, random, vsTop }));
