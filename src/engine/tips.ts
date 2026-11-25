import type { Stage, StageInfo } from './tourney';

/**
 * Conseils de jeu, rassemblés à partir de sources spécialisées (voir SOURCES).
 * Probabilités et logique de tournoi d'abord.
 */

export interface Source {
  name: string;
  url: string;
}

export const SOURCES: Record<string, Source> = {
  harrington: { name: 'Dan Harrington, « Harrington on Hold’em » (zones de M) via PokerListings', url: 'https://www.pokerlistings.com/poker-strategies/tournament-nl-holdem/tournament-nolimit-holdem-harringtons-zone-system' },
  nash: { name: 'PokerStrategy : ranges de Nash pour le tapis ou se coucher', url: 'https://www.pokerstrategy.com/strategy/sit-and-go/1779/' },
  icmTips: { name: 'GTO Wizard / PokerNews : 5 conseils ICM', url: 'https://www.pokernews.com/strategy/crush-poker-tournaments-this-year-with-these-5-icm-tips-46532.htm' },
  bubbleSteal: { name: 'Andrew Brokos (GTO Wizard) : voler les blinds à la bulle avec un tapis court', url: 'https://www.pokernews.com/strategy/how-to-steal-on-the-bubble-with-a-short-stack-gto-wizard-49314.htm' },
  bubbleFactor: { name: 'PokerSkill : le « bubble factor »', url: 'https://www.pokerskill.com/poker-glossary/bubble-factor/' },
  rdjFin: { name: 'Rue des Joueurs : stratégie de fin de tournoi', url: 'https://www.ruedesjoueurs.com/poker/apprendre/strategie/generale/1247-strategie-fin-tournois-poker.html' },
  rdjDebut: { name: 'Rue des Joueurs : stratégie de début de tournoi', url: 'https://www.ruedesjoueurs.com/poker/apprendre/strategie/generale/1137-strategie-debut-tournois-poker.html' },
  pnEarly: { name: 'PokerNews : 10 conseils pour les premiers niveaux', url: 'https://www.pokernews.com/strategy/10-multi-table-tournament-tips-how-play-early-levels-25930.htm' },
  pnMiddle: { name: 'Carlos Welch (PokerNews) : le milieu de Sit & Go', url: 'https://www.pokernews.com/strategy/10-tips-for-sit-go-success-middle-stage-strategy-27825.htm' },
  equityGuide: { name: 'PokerListings : situations d’équité classiques', url: 'https://www.pokerlistings.com/beginners-equity-guide-to-standard-situations-in-no-limit-holdem' },
  potOdds: { name: 'Wikipédia : cote du pot (pot odds)', url: 'https://en.wikipedia.org/wiki/Pot_odds' },
  negreanu: { name: 'Daniel Negreanu (MasterClass) : début et milieu de tournoi', url: 'https://www.masterclass.com/classes/daniel-negreanu-teaches-poker/chapters/tournament-strategy-early-and-middle-stages' },
  mit: { name: 'MIT, cours « Poker Theory and Analytics » : tournois', url: 'https://ocw.mit.edu/courses/15-s50-poker-theory-and-analytics-january-iap-2015/46fde8cc2fdf3e4e0453fe3730680a5e_MIT15_S50IAP15_L5_Tournmt.pdf' },
};

/** Conseil court selon le stade du tournoi, affiché dans les Stats et l'analyse. */
export const STAGE_TIPS: Record<Stage, string> = {
  early:
    'Tapis profonds : petites paires et connecteurs assortis se jouent pas cher pour toucher gros (brelan 12 % du temps au flop). Évite de risquer tout ton tapis sans très grosse main, et ne gonfle pas le pot avec AK ou QQ.',
  middle:
    'Les blinds pèsent : vole-les depuis le cut-off, le bouton et la petite blind. Entre 15 et 25 BB, relancer à tapis sur une ouverture (99+, AQ+) est une arme majeure.',
  late:
    'Blinds élevées : sous 12 BB, une relance normale t’engage déjà, joue « tapis ou se coucher ». Pousse avant d’arriver en grosse blind plutôt que d’attendre une main parfaite.',
  'near-bubble':
    'La bulle approche : les tapis moyens doivent resserrer leurs calls de tapis, les gros tapis peuvent attaquer, les petits tapis poussent dès qu’ils ont une main jouable.',
  bubble:
    'Bulle (ICM au maximum) : perdre ton tapis coûte plus que doubler ne rapporte. Pour payer un tapis il faut nettement plus que la cote du pot. Le gros tapis met la pression ; les tapis moyens évitent de se battre entre eux.',
  itm: 'Dans l’argent : chaque élimination fait grimper les gains, l’ICM reste fort. Le plus petit tapis peut attendre que les autres sautent ; les autres attaquent ses blinds.',
  headsup: 'Tête-à-tête : la cote change tout. Joue très large au bouton (plus de la moitié des mains), défends ta grosse blind souvent, et paie les tapis plus large.',
};

export function stageTip(info: StageInfo | null): string {
  return info ? STAGE_TIPS[info.stage] : '';
}

/** Repères de probabilités et de tournoi, pour l'écran Calculateur. */
export interface Tip {
  title: string;
  body: string;
  source: keyof typeof SOURCES;
}

export const TIPS: { group: string; items: Tip[] }[] = [
  {
    group: 'Probabilités de base',
    items: [
      { title: 'Cote du pot', body: 'Pour suivre, compare tes chances au prix : il faut au moins (mise à payer) ÷ (pot + mise à payer). Payer 50 dans un pot de 100 demande 33 % d’équité.', source: 'potOdds' },
      { title: 'Règle du 4 et du 2', body: 'Au flop, outs × 4 ≈ % d’arriver à la rivière ; au turn, outs × 2. Un tirage couleur (9 outs) vaut ≈ 35 % au flop, ≈ 19 % au turn.', source: 'equityGuide' },
      { title: 'Paire contre deux cartes hautes', body: 'QQ contre AK : 57 % contre 43 %, le fameux « flip ». Une paire contre une paire plus faible : ≈ 82 %. AK contre AQ (main dominée) : ≈ 73 %.', source: 'equityGuide' },
      { title: 'Le flop', body: 'Une paire en main touche un brelan ou mieux 12 % du temps au flop (1 fois sur 8,5). Deux cartes assorties font la couleur au flop moins de 1 % du temps, un tirage couleur ≈ 11 %.', source: 'equityGuide' },
      { title: 'Brelan contre tirages', body: 'Un brelan au flop gagne ≈ 75 % contre un tirage couleur ou quinte, mais seulement ≈ 58 % contre un gros tirage combiné.', source: 'equityGuide' },
    ],
  },
  {
    group: 'Tapis et zones (M de Harrington)',
    items: [
      { title: 'Compter en grosses blinds', body: 'Ton tapis en BB (ou M = tapis ÷ blinds et antes) décide de ton jeu. Zone verte (M ≥ 20) : tout est possible. Jaune (10-20) : moins de petites paires et connecteurs. Orange (6-10) : relance en premier ou couche-toi. Rouge (< 6) : tapis ou se coucher.', source: 'harrington' },
      { title: 'Tapis ou se coucher', body: 'À 10 BB en tête-à-tête, la petite blind pousse ≈ 57 % des mains et la grosse blind paie ≈ 38 %. À 5 BB : ≈ 74 % et 69 %. Plus tu parles tôt à une grande table, plus c’est serré.', source: 'nash' },
      { title: 'Relancer à tapis sur une ouverture', body: 'Entre 15 et 20 BB, pousser sur une relance d’ouverture avec 99+ et AQ+ (77+, AJ+, KQs contre un voleur) gagne souvent les blinds et la relance sans voir le flop.', source: 'pnMiddle' },
    ],
  },
  {
    group: 'Logique de tournoi',
    items: [
      { title: 'Début : jouer profond', body: 'Aux premiers niveaux (100 BB et plus), évite les 3-bets légers et les gros pots avec AK ou QQ ; les petites paires et connecteurs assortis se jouent pour leurs cotes implicites.', source: 'pnEarly' },
      { title: 'Deux écoles au début', body: 'Le jeu serré (mains premium) ou le « small ball » (petites relances de 2,5 à 3 BB, beaucoup de flops en position) : le second convient aux tournois à tapis profonds.', source: 'rdjDebut' },
      { title: 'ICM : la valeur d’un tapis', body: 'Tes gains ne sont pas proportionnels à tes jetons : doubler ne double pas tes gains, mais sauter te coûte tout. Près des places payées il faut donc plus d’équité pour payer un tapis (souvent 55-62 % au lieu de 50 %).', source: 'bubbleFactor' },
      { title: 'Bulle : qui attaque ?', body: 'Le gros tapis attaque les tapis moyens qui veulent entrer dans l’argent. Les tapis moyens jouent prudemment. Remplace les calls par des 3-bets ou des abandons, et défends moins ta grosse blind avec des mains comme QJo ou K10s.', source: 'icmTips' },
      { title: 'Petit tapis à la bulle', body: 'Se coucher a de la valeur (on survit) : un vol doit être plus solide. Dans l’exemple étudié, le bouton à 18 BB n’ouvre que 17 % des mains au lieu de 50 % sans bulle.', source: 'bubbleSteal' },
      { title: 'Fin de tournoi', body: 'Gros tapis : mets la pression sur les tapis moyens et évite les autres gros. Tapis moyen (20-25 BB) : attaque les tapis comparables, évite les calls marginaux contre les petits. Petit tapis (≤ 10 BB) : pousse en visant les tapis moyens.', source: 'rdjFin' },
    ],
  },
];
