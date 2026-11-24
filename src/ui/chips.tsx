import { useEffect, useState } from 'react';

/** Valeurs des jetons, en multiples de la plus petite unité (la petite blind). */
const DENOMS = [
  { v: 1000, cls: 'c1000' },
  { v: 500, cls: 'c500' },
  { v: 100, cls: 'c100' },
  { v: 25, cls: 'c25' },
  { v: 5, cls: 'c5' },
  { v: 1, cls: 'c1' },
];

/** Décompose un montant en jetons (colonnes par valeur), en limitant la hauteur affichée. */
export function chipColumns(amount: number, unit: number, maxCols = 4, maxPerCol = 10) {
  let rest = Math.max(0, Math.round(amount / unit));
  const cols: { cls: string; count: number }[] = [];
  for (const d of DENOMS) {
    const n = Math.floor(rest / d.v);
    if (n > 0) {
      cols.push({ cls: d.cls, count: n });
      rest -= n * d.v;
    }
  }
  return cols.slice(0, maxCols).map((c) => ({ ...c, count: Math.min(c.count, maxPerCol) }));
}

/**
 * Tapis d'un joueur : la hauteur de la pile est proportionnelle au nombre de grosses blinds
 * (1 jeton affiché = 4 BB), répartie en colonnes de 10.
 */
export function stackColumns(amount: number, bigBlind: number) {
  const n = Math.max(amount > 0 ? 1 : 0, Math.min(40, Math.round(amount / (4 * bigBlind))));
  const colors = ['c100', 'c25', 'c5', 'c500'];
  const cols: { cls: string; count: number }[] = [];
  for (let left = n, k = 0; left > 0; k++) {
    cols.push({ cls: colors[k % colors.length], count: Math.min(10, left) });
    left -= 10;
  }
  return cols;
}

export function ChipStack({ amount, unit, small, label, mode = 'value' }: { amount: number; unit: number; small?: boolean; label?: boolean; mode?: 'value' | 'stack' }) {
  if (amount <= 0) return null;
  const cols = mode === 'stack' ? stackColumns(amount, unit * 2) : chipColumns(amount, unit, small ? 3 : 4, small ? 8 : 10);
  return (
    <div className={`chipstack ${small ? 'small' : ''}`}>
      <div className="cols">
        {cols.map((c, i) => (
          <div key={i} className="col">
            {Array.from({ length: c.count }, (_, k) => (
              <span key={k} className={`chip-disc ${c.cls}`} style={{ ['--k' as string]: k }} />
            ))}
          </div>
        ))}
      </div>
      {label && <span className="chip-amount">{amount}</span>}
    </div>
  );
}

export interface Flight {
  id: number;
  amount: number;
  from: [number, number];
  to: [number, number];
  delay: number;
}

/** Jetons qui se déplacent d'un point à un autre de la table (coordonnées en % du tapis). */
export function FlyingChips({ f, unit, onDone }: { f: Flight; unit: number; onDone: (id: number) => void }) {
  const [go, setGo] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setGo(true)));
    const t = setTimeout(() => onDone(f.id), f.delay + 900);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [f, onDone]);
  const [x, y] = go ? f.to : f.from;
  return (
    <div className="flyer" style={{ left: `${x}%`, top: `${y}%`, transitionDelay: `${f.delay}ms` }}>
      <ChipStack amount={f.amount} unit={unit} small />
    </div>
  );
}
