import table from './preflopEquity.json';

/**
 * Équités préflop calculées à l'avance (scripts/precompute-equity.ts) :
 * - contre 1 à 9 mains au hasard ;
 * - en tête-à-tête contre le « top X % » des mains.
 */
const T = table as { widths: number[]; random: Record<string, number[]>; vsTop: Record<string, number[]> };

/** Équité d'une main de départ contre n adversaires aux mains quelconques (1 à 9). */
export function eqVsRandom(name: string, n: number): number {
  const row = T.random[name];
  if (!row) return 0;
  return row[Math.max(1, Math.min(9, Math.round(n))) - 1];
}

/** Équité d'une main de départ contre une main tirée du top `w` (0 à 1) des mains de départ. */
export function eqVsTop(name: string, w: number): number {
  const row = T.vsTop[name];
  if (!row) return 0;
  const ws = T.widths;
  if (w <= ws[0]) return row[0];
  for (let i = 1; i < ws.length; i++) {
    if (w <= ws[i]) {
      const t = (w - ws[i - 1]) / (ws[i] - ws[i - 1]);
      return row[i - 1] + (row[i] - row[i - 1]) * t;
    }
  }
  return row[row.length - 1];
}

/** Équité approchée contre plusieurs ranges (produit des chances de battre chacune, corrigé). */
export function eqVsTops(name: string, ws: number[]): number {
  if (ws.length === 0) return 1;
  if (ws.length === 1) return eqVsTop(name, ws[0]);
  // on corrige le produit par l'écart observé entre « n mains au hasard » et « 1 main au hasard » à la puissance n
  const single = ws.map((w) => eqVsTop(name, w));
  const r1 = eqVsRandom(name, 1);
  const rn = eqVsRandom(name, ws.length);
  const corr = r1 > 0 ? rn / Math.pow(r1, ws.length) : 1;
  return Math.min(1, single.reduce((a, b) => a * b, 1) * corr);
}
