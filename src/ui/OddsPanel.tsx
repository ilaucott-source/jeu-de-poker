import { useMemo } from 'react';
import type { Card } from '../engine/cards';
import { CATEGORY_NAMES_FR, evaluateBest } from '../engine/evaluator';
import { legalActions, potTotal, type HandState } from '../engine/holdem';
import { hitChances, outs, potOddsNeeded, startingHandName } from '../engine/odds';
import {
  ADVICE_FR,
  estimateRanges,
  foldEquityNeeded,
  GRID_LABELS,
  gridName,
  positionOf,
  POSITION_FR,
  preflopChart,
  topPercent,
} from '../engine/ranges';
import { CardView } from './CardView';
import { useEquity } from './useEquity';
import { isCompactLandscape } from './layout';

const pct = (x: number) => `${Math.round(x * 100)} %`;
const topLabel = (x: number) => (x < 0.01 ? 'top 1 %' : `top ${Math.round(x * 100)} %`);

interface Props {
  hand: HandState;
  heroId: string;
  /** montant de relance choisi dans le panneau de mise (si c'est à toi) */
  raiseTo: number | null;
  onClose: () => void;
}

export function OddsPanel({ hand, heroId, raiseTo, onClose }: Props) {
  const heroIndex = hand.players.findIndex((p) => p.id === heroId);
  const hero = hand.players[heroIndex];
  const hole = hero.holeCards;
  const board = hand.board;
  const live = hand.street !== 'complete' && hand.street !== 'showdown';
  const ranges = useMemo(() => (live ? estimateRanges(hand, heroId) : []), [hand, heroId, live]);
  const eq = useEquity(hero.folded ? [] : hole, board, ranges.map((r) => r.top));

  const name = hole.length === 2 ? startingHandName(hole) : '';
  const made = board.length >= 3 && !hero.folded ? CATEGORY_NAMES_FR[evaluateBest([...hole, ...board]).category] : null;
  const pos = positionOf(hand, heroIndex);
  const chart = useMemo(() => (hero.folded ? null : preflopChart(hand, heroIndex)), [hand, heroIndex, hero.folded]);
  const outInfo = useMemo(() => {
    if (board.length < 3 || board.length > 4 || hero.folded) return null;
    const o = outs(hole, board);
    const byCat = new Map<string, Card[]>();
    for (const x of o) byCat.set(x.makes, [...(byCat.get(x.makes) ?? []), x.card]);
    return { count: o.length, byCat: [...byCat.entries()], chances: hitChances(o.length, board.length) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hole.join(''), board.join(''), hero.folded]);

  const myTurn = hand.toAct === heroIndex;
  const legal = myTurn ? legalActions(hand) : null;
  const toCall = Math.max(0, Math.min(hand.currentBet - hero.bet, hero.stack));
  const pot = potTotal(hand);
  const need = potOddsNeeded(toCall, pot);
  const risk = raiseTo && legal?.canBetOrRaise ? raiseTo - hero.bet : 0;
  const feNeed = foldEquityNeeded(risk, pot);
  const fair = ranges.length ? 1 / (ranges.length + 1) : 0;
  const heroAdvice = chart && name ? chart.advise(name) : null;

  return (
    <aside className="odds-panel" aria-label="Statistiques de ta main">
      <header>
        <strong>Statistiques</strong>
        <button className="ghost close" onClick={onClose} aria-label="Fermer les statistiques">✕</button>
      </header>

      {hole.length < 2 ? (
        <p className="muted">Les statistiques apparaissent dès que tu reçois tes cartes.</p>
      ) : (
        <>
          <section className="hand-id">
            <div className="hand-name">{name}</div>
            <div>
              <div>{topLabel(topPercent(name))} des mains de départ</div>
              <div className="muted">
                {POSITION_FR[pos]}
                {made && <> · {made}</>}
              </div>
            </div>
          </section>

          {chart && (
            <section>
              <h4>{chart.title}</h4>
              <p className="muted small">{chart.detail}</p>
              <div className="range-grid" role="img" aria-label="Grille des mains conseillées">
                {GRID_LABELS.map((_, r) =>
                  GRID_LABELS.map((__, c) => {
                    const n = gridName(r, c);
                    return (
                      <i key={n} className={`a-${chart.advise(n)} ${n === name ? 'me' : ''}`} title={`${n} · ${ADVICE_FR[chart.advise(n)]}`}>
                        {r === c ? GRID_LABELS[r] : ''}
                      </i>
                    );
                  }),
                )}
              </div>
              <div className="legend">
                {chart.legend.map((l) => (
                  <span key={l.a}>
                    <i className={`a-${l.a}`} /> {l.label}
                  </span>
                ))}
              </div>
              {heroAdvice && (
                <p className={`verdict a-${heroAdvice}`}>
                  Avec {name} : <b>{ADVICE_FR[heroAdvice]}</b>
                </p>
              )}
            </section>
          )}

          {hero.folded ? (
            <p className="muted">Tu t'es couché sur cette main.</p>
          ) : (
            ranges.length > 0 && (
              <section>
                <h4>Chances de gagner contre</h4>
                <Meter label="leurs mains probables" value={eq?.vsRange} fair={fair} strong />
                <Meter label="des mains au hasard" value={eq?.random} fair={fair} />
                <details className="ranges" open={!isCompactLandscape()}>
                  <summary>Ce qu'on prête à chacun</summary>
                  <ul>
                    {ranges.map((r) => (
                      <li key={r.id}>
                        <b>{r.name}</b> · {r.top < 1 ? topLabel(r.top) : 'toutes mains'} <span>· {r.why}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </section>
            )
          )}

          {!hero.folded && myTurn && toCall > 0 && (
            <section>
              <h4>Pour suivre {toCall}</h4>
              <p>
                Il te faut <b>{pct(need)}</b> de chances de gagner.{' '}
                {eq &&
                  (eq.vsRange >= need ? (
                    <span className="good">Tu as {pct(eq.vsRange)} : suivre est rentable.</span>
                  ) : (
                    <span className="bad">Tu as {pct(eq.vsRange)} : pas assez, sauf gains futurs.</span>
                  ))}
              </p>
            </section>
          )}

          {!hero.folded && risk > 0 && (
            <section>
              <h4>{legal?.isBet ? 'Pour miser' : 'Pour relancer à'} {raiseTo}</h4>
              <p>
                En bluff, ça rapporte si les adversaires se couchent plus de <b>{pct(feNeed)}</b> du temps.
                {eq && (
                  <>
                    {' '}
                    S'ils paient, tu gardes environ <b>{pct(eq.vsRange)}</b> de chances (un peu moins en réalité : ceux qui paient ont souvent de bonnes mains).
                  </>
                )}
              </p>
            </section>
          )}

          {outInfo && (
            <section>
              <h4>
                Outs pour t'améliorer : {outInfo.count}
              </h4>
              {outInfo.byCat.map(([cat, cards]) => (
                <div key={cat} className="out-line">
                  <span>
                    {cat} ×{cards.length}
                  </span>
                  <span className="mini-cards">
                    {cards.slice(0, 9).map((c) => (
                      <CardView key={c} card={c} size="sm" />
                    ))}
                  </span>
                </div>
              ))}
              {outInfo.count > 0 && (
                <p className="muted small">
                  Prochaine carte : {pct(outInfo.chances.next)}
                  {board.length === 3 && <> · jusqu'à la river : {pct(outInfo.chances.byRiver)}</>}
                </p>
              )}
            </section>
          )}
        </>
      )}
    </aside>
  );
}

function Meter({ label, value, fair, strong }: { label: string; value: number | undefined; fair: number; strong?: boolean }) {
  return (
    <div className={`meter ${strong ? 'strong' : ''}`}>
      <div className="meter-head">
        <span>{label}</span>
        <b className={value === undefined ? 'muted' : value >= fair ? 'good' : 'bad'}>{value === undefined ? '…' : pct(value)}</b>
      </div>
      <div className="bar">
        <i style={{ width: `${(value ?? 0) * 100}%` }} />
        <em style={{ left: `${fair * 100}%` }} title="Part équitable" />
      </div>
    </div>
  );
}
