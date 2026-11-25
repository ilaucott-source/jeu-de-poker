import type { HandRecord, TourneyRecord } from './history';
import type { GameVariant } from '../engine/holdem';

/** Zones conseillées propres à l'Omaha (on y joue un peu plus de mains, on y relance moins avant le flop). */
const OMAHA_ZONES: Record<string, { lo: number; hi: number; low?: string; high?: string }> = {
  vpip: { lo: 0.22, hi: 0.35, low: 'Tu joues très peu de mains, même pour l’Omaha : ouvre plus en fin de parole avec les mains connectées et suitées.', high: 'Tu joues trop de mains : à l’Omaha, les mains moyennes font des deuxièmes meilleures mains qui coûtent cher. Garde les mains connectées, suitées (à l’As) et les belles paires.' },
  pfr: { lo: 0.12, hi: 0.25 },
  '3bet': { lo: 0.04, hi: 0.1, low: 'Tu sur-relances rarement : avec les paires d’As bien accompagnées et les meilleures mains connectées double suitées, sur-relance au pot.', high: 'Tu sur-relances beaucoup : à l’Omaha, les équités sont proches avant le flop, garde la sur-relance pour les meilleures mains.' },
  af: { lo: 1.2, hi: 3 },
  wtsd: { lo: 0.26, hi: 0.38 },
  wsd: { lo: 0.46, hi: 0.58 },
};

export interface StatLine {
  key: string;
  label: string;
  value: number | null;
  /** zone conseillée */
  lo: number;
  hi: number;
  max: number;
  unit: '%' | '';
  explain: string;
  low: string;
  high: string;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

/** Zones conseillées au 2-7 Triple Draw (Limit : on joue peu de mains, on relance plus qu'on ne suit). */
const DRAW27_ZONES: Record<string, { lo: number; hi: number; low?: string; high?: string }> = {
  vpip: { lo: 0.2, hi: 0.32, high: 'Tu joues trop de mains : au 2-7, tirer 3 cartes ou garder des cartes au-dessus de 8 coûte cher sur trois tours d’enchères.' },
  pfr: { lo: 0.14, hi: 0.26 },
  '3bet': { lo: 0.05, hi: 0.12, low: 'Tu sur-relances rarement : avec une main faite à 8 ou un tirage à 1 carte vers 7, sur-relance.' },
  af: { lo: 1.2, hi: 3 },
  wtsd: { lo: 0.3, hi: 0.45 },
  wsd: { lo: 0.45, hi: 0.58 },
};

export function summarize(hands: HandRecord[], game: GameVariant | 'all' = 'holdem') {
  const n = hands.length;
  const netBB = hands.reduce((s, h) => s + h.net / h.bb, 0);
  const f = (k: keyof HandRecord['flags']) => hands.filter((h) => h.flags[k]).length;
  const aggr = hands.reduce((s, h) => s + h.flags.aggr, 0);
  const calls = hands.reduce((s, h) => s + h.flags.calls, 0);

  const lines: StatLine[] = [
    {
      key: 'vpip', label: 'Mains jouées (VPIP)', value: ratio(f('vpip'), n), lo: 0.18, hi: 0.28, max: 0.7, unit: '%',
      explain: 'Part des mains où tu mets de l’argent volontairement avant le flop.',
      low: 'Tu joues très peu de mains : tu deviens prévisible et les blinds te grignotent. Ouvre un peu plus en fin de parole (cut-off, bouton).',
      high: 'Tu joues trop de mains : beaucoup de petites mains perdent de l’argent. Resserre surtout en début de parole.',
    },
    {
      key: 'pfr', label: 'Relances avant le flop (PFR)', value: ratio(f('pfr'), n), lo: 0.14, hi: 0.22, max: 0.6, unit: '%',
      explain: 'Part des mains où tu relances avant le flop. Proche du VPIP = jeu agressif, loin = jeu passif.',
      low: 'Tu relances peu : préfère relancer plutôt que suivre quand tu entres dans un coup.',
      high: 'Tu relances très souvent : vérifie que tes mains le justifient, surtout face à plusieurs joueurs.',
    },
    {
      key: '3bet', label: '3-bet', value: ratio(f('threeBet'), f('threeBetChance')), lo: 0.06, hi: 0.11, max: 0.3, unit: '%',
      explain: 'Quand quelqu’un a relancé avant toi, part des fois où tu sur-relances.',
      low: 'Tu sur-relances rarement : avec les meilleures mains (JJ+, AK, AQs) et quelques bluffs assortis, 3-bet plus souvent. La grille des Stats t’aide.',
      high: 'Tu sur-relances beaucoup : les bons joueurs vont te payer ou te relancer avec des mains plus fortes.',
    },
    {
      key: 'af', label: 'Agressivité après le flop', value: ratio(aggr, calls), lo: 1.5, hi: 3.5, max: 6, unit: '',
      explain: 'Mises et relances divisées par les calls, après le flop.',
      low: 'Tu suis beaucoup et mises peu : prends l’initiative avec tes bonnes mains et tes tirages.',
      high: 'Tu mises énormément : attention aux bluffs dans les gros pots et face à plusieurs adversaires.',
    },
    {
      key: 'wtsd', label: 'Va jusqu’à l’abattage', value: ratio(f('showdown'), f('sawFlop')), lo: 0.24, hi: 0.33, max: 0.7, unit: '%',
      explain: 'Quand tu vois le flop, part des mains que tu joues jusqu’à montrer tes cartes.',
      low: 'Tu abandonnes souvent après le flop : les bluffeurs vont en profiter.',
      high: 'Tu vas souvent jusqu’au bout : tu paies probablement trop avec des mains moyennes.',
    },
    {
      key: 'wsd', label: 'Gagne à l’abattage', value: ratio(f('wonShowdown'), f('showdown')), lo: 0.48, hi: 0.6, max: 1, unit: '%',
      explain: 'Part des abattages que tu remportes.',
      low: 'Tu perds souvent à l’abattage : tu paies avec des mains trop faibles.',
      high: 'Tu gagnes presque toujours à l’abattage : tu pourrais miser plus souvent pour la valeur, ou payer un peu plus large.',
    },
  ];

  if (game === 'omaha' || game === 'draw27')
    for (const l of lines) {
      const z = (game === 'omaha' ? OMAHA_ZONES : DRAW27_ZONES)[l.key];
      if (z) Object.assign(l, { lo: z.lo, hi: z.hi }, z.low ? { low: z.low } : {}, z.high ? { high: z.high } : {});
    }

  const byPos = new Map<string, { n: number; net: number }>();
  for (const h of hands) {
    const p = h.heroPos.replace('*', '');
    const x = byPos.get(p) ?? { n: 0, net: 0 };
    x.n++;
    x.net += h.net / h.bb;
    byPos.set(p, x);
  }
  const order = ['UTG', 'UTG+1', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
  const positions = order.filter((p) => byPos.has(p)).map((p) => ({ pos: p, ...byPos.get(p)! }));

  const decisions = hands.flatMap((h) => h.decisions ?? []);
  const grades = { good: 0, ok: 0, mistake: 0 };
  for (const d of decisions) grades[d.grade]++;
  const mistakes = new Map<string, number>();
  for (const d of decisions) if (d.grade !== 'good' && d.tag) mistakes.set(d.tag, (mistakes.get(d.tag) ?? 0) + 1);
  const topMistakes = [...mistakes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tag, count]) => ({ tag, count, ...(MISTAKE_FR[tag] ?? { label: tag, tip: '' }) }));

  let acc = 0;
  const curve = hands.map((h) => (acc += h.net / h.bb));

  return { n, netBB, bb100: n ? (netBB / n) * 100 : 0, lines, positions, grades, decisions: decisions.length, topMistakes, curve };
}

export function summarizeTourneys(list: TourneyRecord[]) {
  const n = list.length;
  const wins = list.filter((t) => t.place === 1).length;
  const itm = list.filter((t) => t.place <= (t.players <= 3 ? 1 : t.players <= 5 ? 2 : 3)).length;
  const avg = n ? list.reduce((s, t) => s + t.place, 0) / n : 0;
  return { n, wins, itm, avg };
}

export const POS_SHORT: Record<string, string> = { UTG: 'UTG', 'UTG+1': 'UTG+1', MP: 'Milieu', HJ: 'Hijack', CO: 'Cut-off', BTN: 'Bouton', SB: 'Petite blind', BB: 'Grosse blind' };

export const MISTAKE_FR: Record<string, { label: string; tip: string }> = {
  'icm-call': { label: 'Tapis payés trop légèrement en tournoi (ICM)', tip: 'Près des places payées, il faut nettement plus que la cote du pot pour payer un tapis : sauter coûte plus que doubler ne rapporte.' },
  'pre-loose': { label: 'Mains trop faibles jouées avant le flop', tip: 'Suis la grille des Stats : en début de parole, couche les mains hors du top conseillé.' },
  'pre-tight': { label: 'Bonnes mains couchées avant le flop', tip: 'Ces mains sont rentables à cette position : ose les jouer.' },
  'pre-passive': { label: 'Call au lieu de relancer avant le flop', tip: 'Avec une main forte, relance : tu gagnes plus et tu réduis le nombre d’adversaires.' },
  'pre-ambitious': { label: 'Relances un peu ambitieuses avant le flop', tip: 'Ces mains se jouent mieux en suivant.' },
  'fold-odds': { label: 'Abandons alors que la cote était bonne', tip: 'Compare tes chances au prix demandé (Stats, « Pour suivre ») avant de te coucher.' },
  'call-no-odds': { label: 'Calls sans la cote', tip: 'Si le prix demandé dépasse tes chances de gagner, couche-toi, même avec un tirage.' },
  'raise-missed': { label: 'Grosses mains jouées passivement', tip: 'Relance tes mains très fortes pour faire grossir le pot.' },
  'missed-value': { label: 'Mises de valeur manquées', tip: 'Quand tu as probablement la meilleure main, mise : les mains moins fortes te paieront.' },
  'multi-bluff': { label: 'Bluffs contre plusieurs adversaires', tip: 'Garde tes bluffs pour les coups à un seul adversaire.' },
  'bluff-raise': { label: 'Relances en bluff', tip: 'Bien, mais pas contre les joueurs qui paient tout (Le Débutant, Le Fêtard).' },
  'draw-pat': { label: 'Servi avec une main trop faible (2-7)', tip: 'Reste servi seulement avec une main faite à 9 ou mieux (10 au dernier tirage) ; sinon change tes cartes hautes.' },
  'draw-too-many': { label: 'Trop de cartes changées (2-7)', tip: 'Garde tes cartes basses différentes : tirer 3 cartes au lieu de 2 fait chuter tes chances.' },
  'draw-keep-high': { label: 'Cartes trop hautes gardées (2-7)', tip: 'Au 2-7, une carte au-dessus de 8 est presque toujours à changer, sauf au dernier tirage avec une main faite.' },
  'weak-bet': { label: 'Mises sans grosse main', tip: 'Choisis tes bluffs : un seul adversaire, une carte qui fait peur, une histoire cohérente.' },
};
