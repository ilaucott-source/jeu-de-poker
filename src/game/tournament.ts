/** Structure d'un tournoi à une table (Sit & Go). */
export interface BlindLevel {
  sb: number;
  bb: number;
  ante: number;
}

export const TOURNEY_STACK = 1500;

export const BLIND_LEVELS: BlindLevel[] = [
  { sb: 10, bb: 20, ante: 0 },
  { sb: 15, bb: 30, ante: 0 },
  { sb: 25, bb: 50, ante: 0 },
  { sb: 50, bb: 100, ante: 0 },
  { sb: 75, bb: 150, ante: 0 },
  { sb: 100, bb: 200, ante: 25 },
  { sb: 150, bb: 300, ante: 25 },
  { sb: 200, bb: 400, ante: 50 },
  { sb: 300, bb: 600, ante: 75 },
  { sb: 400, bb: 800, ante: 100 },
  { sb: 600, bb: 1200, ante: 150 },
  { sb: 800, bb: 1600, ante: 200 },
  { sb: 1000, bb: 2000, ante: 250 },
  { sb: 1500, bb: 3000, ante: 400 },
  { sb: 2000, bb: 4000, ante: 500 },
];

export type TourneySpeed = 'normal' | 'turbo';
export const SPEED: Record<TourneySpeed, { label: string; handsPerLevel: number; hint: string }> = {
  normal: { label: 'Normal', handsPerLevel: 10, hint: 'Les blinds montent toutes les 10 mains.' },
  turbo: { label: 'Turbo', handsPerLevel: 6, hint: 'Les blinds montent toutes les 6 mains : ça va vite.' },
};

export const levelFor = (handNo: number, speed: TourneySpeed) =>
  Math.min(BLIND_LEVELS.length - 1, Math.floor(Math.max(0, handNo - 1) / SPEED[speed].handsPerLevel));

/** Nombre de places payées et répartition des gains selon le nombre de joueurs. */
export function payouts(players: number): number[] {
  if (players <= 3) return [1];
  if (players <= 5) return [0.65, 0.35];
  return [0.5, 0.3, 0.2];
}

export const ordinalFR = (n: number) => (n === 1 ? '1er' : `${n}e`);
