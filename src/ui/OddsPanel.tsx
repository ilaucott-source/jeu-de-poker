import { useMemo } from 'react';
import type { Card } from '../engine/cards';
import { CATEGORY_NAMES_FR, evaluateBest } from '../engine/evaluator';
import { potTotal, type HandState } from '../engine/holdem';
import { equity, hitChances, outs, potOddsNeeded, startingHandName, startingHandPercentile } from '../engine/odds';
import { CardView } from './CardView';

const pct = (x: number) => `${Math.round(x * 100)} %`;

export function OddsPanel({ hand, heroId, onClose }: { hand: HandState; heroId: string; onClose: () => void }) {
  const hero = hand.players.find((p) => p.id === heroId)!;
  const opponents = hand.players.filter((p) => p.id !== heroId && !p.out && !p.folded).length;
  const hole = hero.holeCards;
  const board = hand.board;
  const key = `${hole.join('')}|${board.join('')}|${opponents}`;

  const stats = useMemo(() => {
    if (hole.length < 2 || opponents === 0) return null;
    const eq = equity(hole, board, opponents, board.length === 0 ? 1500 : 1200, hole.length * 97 + board.length);
    const o = outs(hole, board);
    const byCat = new Map<string, Card[]>();
    for (const x of o) byCat.set(x.makes, [...(byCat.get(x.makes) ?? []), x.card]);
    return {
      eq,
      outs: o,
      byCat: [...byCat.entries()],
      chances: hitChances(o.length, board.length),
      made: board.length >= 3 ? CATEGORY_NAMES_FR[evaluateBest([...hole, ...board]).category] : null,
      name: startingHandName(hole),
      top: startingHandPercentile(hole),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const toCall = Math.max(0, Math.min(hand.currentBet - hero.bet, hero.stack));
  const pot = potTotal(hand);
  const need = potOddsNeeded(toCall, pot);
  const fair = 1 / (opponents + 1);

  return (
    <aside className="odds-panel" aria-label="Statistiques de ta main">
      <header>
        <strong>Tes statistiques</strong>
        <button className="ghost" onClick={onClose} aria-label="Fermer les statistiques">✕</button>
      </header>
      {hero.folded ? (
        <p className="muted">Tu t'es couché sur cette main.</p>
      ) : !stats ? (
        <p className="muted">Les statistiques apparaissent quand tu as des cartes et au moins un adversaire.</p>
      ) : (
        <>
          <div className="row">
            <span>Main de départ</span>
            <b>
              {stats.name} · top {Math.max(1, Math.round(stats.top * 100))} %
            </b>
          </div>
          {stats.made && (
            <div className="row">
              <span>Main actuelle</span>
              <b>{stats.made}</b>
            </div>
          )}
          <div className="eq">
            <div className="row">
              <span>
                Équité contre {opponents} adversaire{opponents > 1 ? 's' : ''}
              </span>
              <b className={stats.eq.equity >= fair ? 'good' : 'bad'}>{pct(stats.eq.equity)}</b>
            </div>
            <div className="bar">
              <i style={{ width: `${stats.eq.equity * 100}%` }} />
              <em style={{ left: `${fair * 100}%` }} title="Part équitable" />
            </div>
            <small>
              Part équitable à {opponents + 1} joueurs : {pct(fair)}. Calcul contre des mains au hasard.
            </small>
          </div>
          {board.length >= 3 && board.length <= 4 && (
            <div className="outs">
              <div className="row">
                <span>Outs pour t'améliorer</span>
                <b>{stats.outs.length}</b>
              </div>
              {stats.byCat.map(([cat, cards]) => (
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
              {stats.outs.length > 0 && (
                <small>
                  Prochaine carte : {pct(stats.chances.next)}
                  {board.length === 3 && <> · jusqu'à la river : {pct(stats.chances.byRiver)}</>}
                </small>
              )}
            </div>
          )}
          {toCall > 0 && (
            <div className="potodds">
              <div className="row">
                <span>Cote du pot</span>
                <b>
                  {toCall} pour {pot + toCall}
                </b>
              </div>
              <small>
                Il te faut au moins {pct(need)} d'équité pour que suivre soit rentable.{' '}
                {stats.eq.equity >= need ? (
                  <span className="good">Ton équité est suffisante.</span>
                ) : (
                  <span className="bad">Ton équité est insuffisante (sauf gains futurs).</span>
                )}
              </small>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
