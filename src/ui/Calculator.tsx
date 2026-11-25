import { useMemo, useState } from 'react';
import { combosOf, GRID_LABELS, gridName, openRange, POSITION_FR, topPercent } from '../engine/ranges';
import { eqVsRandom, eqVsTop } from '../engine/preflopTable';
import { callShoveRange, pushRange } from '../engine/tourney';
import { exampleCards, flopOdds } from '../engine/flopOdds';
import { SOURCES, TIPS } from '../engine/tips';
import { CardView } from './CardView';

type Tab = 'calc' | 'tips';
const pct = (x: number) => `${Math.round(x * 100)} %`;
const pct1 = (x: number) => `${(Math.round(x * 1000) / 10).toLocaleString('fr-FR')} %`;
const STACKS = [5, 8, 10, 12, 15, 20, 30, 50, 100];

/** Positions présentes à une table de n joueurs, du premier de parole à la grosse blind. */
function positionsFor(n: number): string[] {
  if (n === 2) return ['BTN', 'BB'];
  const m = n - 3;
  const mid: string[] = [];
  for (let d = m - 1; d >= 0; d--) {
    if (d === m - 1 && m >= 3) mid.push(m >= 5 ? 'UTG*' : 'UTG');
    else if (d === m - 2 && m >= 5) mid.push('UTG+1');
    else mid.push(d === 0 ? 'CO' : d === 1 ? 'HJ' : d === m - 1 ? 'UTG' : 'MP');
  }
  return [...mid, 'BTN', 'SB', 'BB'];
}
const SHORT: Record<string, string> = { UTG: 'UTG', 'UTG*': 'UTG', 'UTG+1': 'UTG+1', MP: 'MP', HJ: 'HJ', CO: 'CO', BTN: 'BTN', SB: 'SB', BB: 'BB' };

/** Couleur d'une case selon l'équité, comparée à la part équitable. */
function heat(e: number, fair: number) {
  const r = e / fair; // 1 = part équitable
  if (r >= 1.6) return 'h5';
  if (r >= 1.3) return 'h4';
  if (r >= 1.1) return 'h3';
  if (r >= 0.95) return 'h2';
  if (r >= 0.8) return 'h1';
  return 'h0';
}

export function Calculator({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('calc');
  const [hand, setHand] = useState('AKs');
  const [opp, setOpp] = useState(5);
  const players = opp + 1;
  const positions = positionsFor(players);
  const [posRaw, setPos] = useState('BTN');
  const pos = positions.includes(posRaw) ? posRaw : positions[positions.length - 3] ?? positions[0];
  const [stack, setStack] = useState(100);

  const fair = 1 / (opp + 1);
  const eq = eqVsRandom(hand, opp);
  const top = topPercent(hand);
  const headsUp = players === 2;
  const open = openRange(pos, headsUp);
  const push = pushRange(pos, stack, headsUp);
  const odds = useMemo(() => flopOdds(exampleCards(hand)), [hand]);
  const cards = exampleCards(hand);
  const pocket = hand.length === 2;

  let verdict: { cls: string; text: string };
  if (stack <= 12 && pos !== 'BB') verdict = top <= push ? { cls: 'a-raise', text: `Tapis : ${hand} est dans le top ${pct(push)} à pousser depuis ${SHORT[pos]} avec ${stack} BB.` } : { cls: 'a-fold', text: `Se coucher : à ${stack} BB, on ne pousse que le top ${pct(push)} depuis ${SHORT[pos]}.` };
  else if (pos === 'BB') verdict = { cls: 'a-call', text: `Grosse blind : défends souvent face à une relance, surtout avec des mains assorties ou connectées. Relance le top 20 % si les autres ont seulement suivi.` };
  else verdict = top <= open ? { cls: 'a-raise', text: `Relance d’ouverture : ${hand} fait partie du top ${pct(open)} à ouvrir depuis ${SHORT[pos]}.` } : { cls: 'a-fold', text: `Se coucher si personne n’a relancé : depuis ${SHORT[pos]}, on ouvre le top ${pct(open)}.` };

  const callShove = callShoveRange(pushRange('BTN', stack, headsUp), stack);

  return (
    <div className="progress-screen calc-screen">
      <header className="topbar">
        <button className="pill" onClick={onClose}>‹ Menu</button>
        <span className="title"><b>Probabilités</b></span>
        <div className="segmented calc-tabs">
          <button className={tab === 'calc' ? 'on' : ''} onClick={() => setTab('calc')}>Calculateur</button>
          <button className={tab === 'tips' ? 'on' : ''} onClick={() => setTab('tips')}>Repères</button>
        </div>
      </header>
      {tab === 'calc' ? (
        <div className="calc">
          <section className="calc-grid-col">
            <div className="calc-controls">
              <label>Adversaires</label>
              <div className="segmented small-seg">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                  <button key={n} className={n === opp ? 'on' : ''} onClick={() => setOpp(n)}>{n}</button>
                ))}
              </div>
            </div>
            <div className="range-grid calc-grid" role="grid" aria-label="Choisis une main de départ">
              {GRID_LABELS.map((_, r) =>
                GRID_LABELS.map((__, c) => {
                  const n = gridName(r, c);
                  const e = eqVsRandom(n, opp);
                  return (
                    <button key={n} className={`${heat(e, fair)} ${n === hand ? 'me' : ''}`} onClick={() => setHand(n)} title={`${n} · ${pct(e)}`}>
                      <span>{n.replace(/T/g, '10')}</span>
                      <small>{Math.round(e * 100)}</small>
                    </button>
                  );
                }),
              )}
            </div>
            <p className="muted small">Chiffre de chaque case : % de chances de gagner contre {opp} main{opp > 1 ? 's' : ''} au hasard, jusqu’à la rivière. Part équitable : {pct(fair)}.</p>
          </section>

          <section className="calc-info">
            <div className="card-block calc-hand">
              <div className="calc-cards">
                {cards.map((c) => <CardView key={c} card={c} size="md" />)}
              </div>
              <div>
                <div className="calc-name">{hand.replace(/T/g, '10')}</div>
                <div className="muted small">Top {pct1(top)} des mains · {combosOf(hand)} combinaisons sur 1 326</div>
              </div>
              <div className="calc-eq">
                <b>{pct(eq)}</b>
                <small>contre {opp} au hasard</small>
                <small className={eq >= fair ? 'good' : 'bad'}>{(eq / fair).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} × la part équitable</small>
              </div>
            </div>

            <div className="card-block">
              <h3>En tête-à-tête, contre…</h3>
              <ul className="calc-list">
                <li><span>une main au hasard</span><b>{pct(eqVsRandom(hand, 1))}</b></li>
                <li><span>une ouverture du bouton (top 45 %)</span><b>{pct(eqVsTop(hand, 0.45))}</b></li>
                <li><span>une ouverture du premier de parole (top 15 %)</span><b>{pct(eqVsTop(hand, 0.15))}</b></li>
                <li><span>un 3-bet (top 7 %)</span><b>{pct(eqVsTop(hand, 0.07))}</b></li>
                <li><span>un 4-bet (top 3 %)</span><b>{pct(eqVsTop(hand, 0.03))}</b></li>
              </ul>
            </div>

            <div className="card-block">
              <h3>Position et tapis</h3>
              <div className="segmented small-seg">
                {positions.map((p) => (
                  <button key={p} className={p === pos ? 'on' : ''} onClick={() => setPos(p)} title={POSITION_FR[p]}>{SHORT[p]}</button>
                ))}
              </div>
              <div className="segmented small-seg">
                {STACKS.map((s) => (
                  <button key={s} className={s === stack ? 'on' : ''} onClick={() => setStack(s)}>{s}</button>
                ))}
              </div>
              <p className="muted small">Tapis en grosses blinds (BB) · {POSITION_FR[pos]} · table de {players}</p>
              <p className={`verdict ${verdict.cls}`}>{verdict.text}</p>
              {stack <= 20 && (
                <p className="muted small">
                  Payer un tapis du bouton à {stack} BB : équité {pct(eqVsTop(hand, pushRange('BTN', stack, headsUp)))} contre sa range (top {pct(pushRange('BTN', stack, headsUp))}) ;
                  on paie en gros le top {pct(callShove)} (sans ICM, il faut plus à la bulle).
                </p>
              )}
            </div>

            <div className="card-block">
              <h3>Au flop</h3>
              <ul className="calc-list">
                {pocket ? (
                  <li><span>brelan ou mieux</span><b>{pct1(odds.tripsPlus)}</b></li>
                ) : (
                  <>
                    <li><span>paire ou mieux avec tes cartes</span><b>{pct1(odds.pairPlus)}</b></li>
                    <li><span>deux paires ou mieux</span><b>{pct1(odds.twoPairPlus)}</b></li>
                  </>
                )}
                <li><span>quinte ou mieux</span><b>{pct1(odds.straightPlus)}</b></li>
                {!pocket && hand.endsWith('s') && (
                  <>
                    <li><span>couleur faite</span><b>{pct1(odds.flushPlus)}</b></li>
                    <li><span>tirage couleur</span><b>{pct1(odds.flushDraw)}</b></li>
                  </>
                )}
                <li><span>tirage quinte par les deux bouts</span><b>{pct1(odds.straightDraw)}</b></li>
              </ul>
              <p className="muted small">Calcul exact sur les 19 600 flops possibles. Règle du 4 et du 2 : outs × 4 au flop, × 2 au turn.</p>
            </div>
          </section>
        </div>
      ) : (
        <div className="progress tips">
          {TIPS.map((g) => (
            <div key={g.group} className="card-block">
              <h3>{g.group}</h3>
              {g.items.map((t) => (
                <div key={t.title} className="tip">
                  <b>{t.title}</b>
                  <p>{t.body}</p>
                  <a href={SOURCES[t.source].url} target="_blank" rel="noreferrer">{SOURCES[t.source].name}</a>
                </div>
              ))}
            </div>
          ))}
          <div className="card-block">
            <h3>Toutes les sources</h3>
            <ul className="sources">
              {Object.values(SOURCES).map((s) => (
                <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.name}</a></li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
