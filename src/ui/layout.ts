/** Positions des sièges autour de la table, en % du tapis (le héros est toujours en bas). */
type P = [number, number];
const DESK: Record<number, P[]> = {
  2: [[50, 88], [50, 8]],
  3: [[50, 88], [15, 18], [85, 18]],
  4: [[50, 88], [10, 45], [50, 8], [90, 45]],
  5: [[50, 88], [10, 60], [28, 10], [72, 10], [90, 60]],
  6: [[50, 88], [10, 70], [10, 24], [50, 8], [90, 24], [90, 70]],
};
const LAND: Record<number, P[]> = {
  2: [[50, 84], [50, 10]],
  3: [[50, 84], [15, 20], [85, 20]],
  4: [[50, 84], [13, 45], [50, 10], [87, 45]],
  5: [[50, 84], [13, 62], [32, 13], [68, 13], [87, 62]],
  6: [[50, 84], [13, 72], [13, 26], [50, 10], [87, 26], [87, 72]],
};

export const isCompactLandscape = () =>
  typeof window !== 'undefined' && window.matchMedia('(orientation: landscape) and (max-height: 520px)').matches;

export function seatPos(n: number, i: number, compact: boolean): P {
  return (compact ? LAND : DESK)[n]?.[i] ?? [50, 50];
}

/** Où posent leurs mises les joueurs : entre leur siège et le centre. */
export function betPos(n: number, i: number, compact: boolean): P {
  const [x, y] = seatPos(n, i, compact);
  if (i === 0) return compact ? [72, 80] : [37, 76];
  const t = 0.34;
  return [x + (50 - x) * t, y + (48 - y) * t + (y < 30 ? 6 : 0)];
}

/** Position du pot (sous le tableau). */
export const potPos = (compact: boolean): P => (compact ? [50, 60] : [50, 56]);
