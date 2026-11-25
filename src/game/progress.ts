import type { HandRecord, TourneyRecord } from './history';

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

export function summarize(hands: HandRecord[]) {
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
  'weak-bet': { label: 'Mises sans grosse main', tip: 'Choisis tes bluffs : un seul adversaire, une carte qui fait peur, une histoire cohérente.' },
};
