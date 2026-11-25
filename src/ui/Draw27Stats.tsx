import { useMemo } from 'react';
import { legalActions, potTotal, type HandState } from '../engine/holdem';
import { draw27PreChart, drawsLeft, opponents27 } from '../engine/draw27';
import { describe27, drawText, planDraw, top27 } from '../engine/lowball';
import { potOddsNeeded } from '../engine/odds';
import { ADVICE_FR, positionOf, POSITION_FR } from '../engine/ranges';
import { stageOf } from '../engine/tourney';
import { stageTip } from '../engine/tips';
import { Meter, TopScale } from './OddsPanel';
import { useEquity27 } from './useEquity';

const pct = (x: number) => `${Math.round(x * 100)} %`;
const RT: Record<string, string> = { T: '10', J: 'V', Q: 'D', K: 'R', A: 'A' };

interface Props {
  hand: HandState;
  heroId: string;
  raiseTo: number | null;
  onClose: () => void;
}

/** Statistiques du 2-7 Triple Draw : force de la main, tirage conseillé, chances contre les tirages adverses, cote du pot. */
export function Draw27Stats({ hand, heroId, onClose }: Props) {
  const heroIndex = hand.players.findIndex((p) => p.id === heroId);
  const hero = hand.players[heroIndex];
  const hole = hero.holeCards;
  const live = hand.street !== 'complete' && hand.street !== 'showdown';
  const opps = useMemo(() => (live ? opponents27(hand, heroId) : []), [hand, heroId, live]);
  const left = drawsLeft(hand);
  const drawsKey = hand.log.filter((a) => a.type === 'draw' || a.type === 'fold').length;
  const eq = useEquity27(live && !hero.folded && opps.length ? hand : null, heroId, `${hole.join('')}|${drawsKey}|${hand.street}|${opps.length}`);
  const chart = useMemo(() => (hero.folded ? null : draw27PreChart(hand, heroIndex)), [hand, heroIndex, hero.folded]);
  const t = top27(hole);
  const advice = chart?.adviseTop(t);
  const rec = left > 0 && hole.length === 5 ? planDraw(hole, left) : null;
  const pos = positionOf(hand, heroIndex);
  const stage = stageOf(hand);
  const legal = hand.toAct === heroIndex ? legalActions(hand) : null;
  const toCall = legal?.callAmount ?? 0;
  const need = potOddsNeeded(toCall, potTotal(hand));
  const fair = opps.length ? 1 / (opps.length + 1) : 0;
  const shortName = [...hole].map((c) => c[0]).sort((a, b) => '23456789TJQKA'.indexOf(b) - '23456789TJQKA'.indexOf(a)).map((r) => RT[r] ?? r).join('-');

  return (
    <aside className="odds-panel" aria-label="Statistiques de ta main">
      <header>
        <strong>Statistiques</strong>
        <button className="ghost close" onClick={onClose} aria-label="Fermer les statistiques">✕</button>
      </header>
      {hole.length < 5 ? (
        <p className="muted">Les statistiques apparaissent dès que tu reçois tes cartes.</p>
      ) : (
        <>
          <section className="hand-id">
            <div className="hand-name draw-name">{shortName}</div>
            <div>
              <div>{describe27(hole)}</div>
              <div className="muted">
                {POSITION_FR[pos]} · {left === 0 ? 'plus de tirage' : `${left} tirage${left > 1 ? 's' : ''} restant${left > 1 ? 's' : ''}`}
              </div>
            </div>
          </section>

          {stage && (
            <section className="stage-box">
              <h4>{stage.label}</h4>
              <p className="muted small stage-tip">{stageTip(stage)}</p>
            </section>
          )}

          {chart && (
            <section>
              <h4>{chart.title}</h4>
              <p className="muted small">{stage ? chart.detail.split(` ${stage.label} :`)[0] : chart.detail}</p>
              <TopScale chart={chart} t={t} />
              <div className="legend">
                {chart.legend.map((l) => (
                  <span key={l.a}>
                    <i className={`a-${l.a}`} /> {l.label}
                  </span>
                ))}
              </div>
              {advice && (
                <p className={`verdict a-${advice}`}>
                  Ta main : <b>{ADVICE_FR[advice]}</b>
                </p>
              )}
            </section>
          )}

          {rec && !hero.folded && (
            <section>
              <h4>{hand.drawPending?.length ? 'Tirage conseillé maintenant' : 'Au prochain tirage'}</h4>
              <p>
                <b>{drawText(hole, rec).replace(/^./, (c) => c.toUpperCase())}</b>.
              </p>
              <p className="muted small">
                On garde les cartes basses différentes ({left >= 2 ? '8 ou moins' : '9 ou moins au dernier tirage'}) et on reste servi avec une main faite à {left >= 2 ? '9' : '10'} ou mieux. Une paire, une quinte ou une couleur comptent contre toi.
              </p>
            </section>
          )}

          {hero.folded ? (
            <p className="muted">Tu t'es couché sur cette main.</p>
          ) : (
            opps.length > 0 && (
              <section>
                <h4>Chances de gagner</h4>
                <Meter label={`contre ${opps.length > 1 ? 'leurs mains probables' : 'sa main probable'}`} value={eq} fair={fair} strong />
                <ul className="ranges-list">
                  {opps.map((o) => (
                    <li key={o.id}>
                      <b>{o.name}</b> · {o.pre === 2 ? 'a relancé avant le tirage' : o.pre === 1 ? 'a suivi une relance' : 'est entré sans relancer'}
                      {o.draws.length > 0 && <> · a changé {o.draws.map((d) => (d === 0 ? 'servi' : d)).join(', puis ')}</>}
                    </li>
                  ))}
                </ul>
                <p className="muted small">Calcul : on imagine des mains adverses compatibles avec leurs tirages, puis chacun finit ses tirages au mieux.</p>
              </section>
            )
          )}

          {!hero.folded && toCall > 0 && (
            <section>
              <h4>Pour suivre {toCall}</h4>
              <p>
                Il te faut <b>{pct(need)}</b> de chances de gagner.{' '}
                {eq !== undefined &&
                  (eq >= need ? <span className="good">Tu as {pct(eq)} : suivre est rentable.</span> : <span className="bad">Tu as {pct(eq)} : pas assez.</span>)}
              </p>
            </section>
          )}
        </>
      )}
    </aside>
  );
}
