/** Positions des sièges autour de la table, en % du tapis (le héros est toujours en bas). */
type P = [number, number];
const DESK: Record<number, P[]> = {
  2: [[50, 88], [50, 8]],
  3: [[50, 88], [15, 18], [85, 18]],
  4: [[50, 88], [10, 45], [50, 8], [90, 45]],
  5: [[50, 88], [10, 60], [28, 10], [72, 10], [90, 60]],
  6: [[50, 88], [10, 70], [10, 24], [50, 8], [90, 24], [90, 70]],
  7: [[50, 88], [15, 76], [9, 32], [36, 7], [64, 7], [91, 32], [85, 76]],
  8: [[50, 88], [20, 86], [8, 50], [22, 10], [50, 6], [78, 10], [92, 50], [80, 86]],
  9: [[50, 88], [22, 88], [8, 62], [11, 26], [35, 7], [65, 7], [89, 26], [92, 62], [78, 88]],
  10: [[50, 88], [24, 88], [8, 66], [8, 32], [27, 8], [50, 6], [73, 8], [92, 32], [92, 66], [76, 88]],
};
const LAND: Record<number, P[]> = {
  2: [[50, 84], [50, 10]],
  3: [[50, 84], [15, 20], [85, 20]],
  4: [[50, 84], [13, 45], [50, 10], [87, 45]],
  5: [[50, 84], [13, 62], [32, 13], [68, 13], [87, 62]],
  6: [[50, 84], [13, 72], [13, 26], [50, 10], [87, 26], [87, 72]],
  7: [[50, 84], [15, 76], [11, 32], [35, 10], [65, 10], [89, 32], [85, 76]],
  8: [[50, 84], [17, 82], [10, 46], [24, 11], [50, 9], [76, 11], [90, 46], [83, 82]],
  9: [[50, 84], [15, 84], [10, 56], [13, 22], [37, 9], [63, 9], [87, 22], [90, 56], [85, 84]],
  10: [[50, 84], [15, 85], [9, 60], [11, 30], [29, 9], [50, 8], [71, 9], [89, 30], [91, 60], [85, 85]],
};

export const isCompactLandscape = () =>
  typeof window !== 'undefined' && window.matchMedia('(orientation: landscape) and (max-height: 520px)').matches;

export function seatPos(n: number, i: number, compact: boolean): P {
  return (compact ? LAND : DESK)[n]?.[i] ?? [50, 50];
}

/** Où posent leurs mises les joueurs : entre leur siège et le centre. */
export function betPos(n: number, i: number, compact: boolean): P {
  const [x, y] = seatPos(n, i, compact);
  if (i === 0) return compact ? (n >= 8 ? [64, 70] : [72, 80]) : n >= 8 ? [40, 72] : [37, 76];
  const t = 0.34;
  return [x + (50 - x) * t, y + (48 - y) * t + (y < 30 ? 6 : 0)];
}

/** Position du pot (sous le tableau). */
export const potPos = (compact: boolean): P => (compact ? [50, 60] : [50, 56]);
