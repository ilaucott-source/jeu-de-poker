import { useMemo, useState } from 'react';
import { clearHistory, loadHands, loadTourneys, type HandRecord } from '../game/history';
import { POS_SHORT, summarize, summarizeTourneys, type StatLine } from '../game/progress';
import { ordinalFR } from '../game/tournament';
import { handNameFor, VARIANT_FR } from '../engine/variant';
import type { GameVariant } from '../engine/holdem';
import { CardView } from './CardView';
import { HandReview } from './HandReview';

type Tab = 'stats' | 'hands' | 'tourneys';
type ModeFilter = 'all' | 'cash' | 'tournament';
const PERIODS = [50, 200, 0] as const;

const pctTxt = (x: number) => `${Math.round(x * 100)} %`;
const bb = (x: number) => `${x > 0 ? '+' : ''}${Math.round(x * 10) / 10}`;

export function Progress({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('stats');
  const [mode, setMode] = useState<ModeFilter>('all');
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(200);
  const [open, setOpen] = useState<HandRecord | null>(null);
  const [version, setVersion] = useState(0);

  const all = useMemo(() => loadHands(), [version]);
  // par défaut : le jeu de la dernière main jouée (les zones conseillées dépendent du jeu)
  const [game, setGame] = useState<GameVariant | 'all'>(() => all[all.length - 1]?.game ?? 'holdem');
  const games = useMemo(() => [...new Set(all.map((h) => h.game ?? 'holdem'))], [all]);
  const hands = useMemo(() => {
    const f = all.filter((h) => (mode === 'all' || h.mode === mode) && (game === 'all' || (h.game ?? 'holdem') === game));
    return period ? f.slice(-period) : f;
  }, [all, mode, period, game]);
  const s = useMemo(() => summarize(hands, game), [hands, game]);
  const tourneys = useMemo(() => loadTourneys().filter((x) => game === 'all' || (x.game ?? 'holdem') === game), [version, game]);
  const t = summarizeTourneys(tourneys);

  return (
    <div className="progress-screen">
      <header className="topbar">
        <button className="pill" onClick={onClose}>‹ Menu</button>
        <span className="title"><b>Ma progression</b></span>
        <span />
      </header>
      <div className="progress">
        <div className="progress-controls">
          <div className="segmented">
            {(['stats', 'hands', 'tourneys'] as Tab[]).map((k) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {k === 'stats' ? 'Statistiques' : k === 'hands' ? 'Mes mains' : 'Tournois'}
              </button>
            ))}
          </div>
          <div className="filters">
            {games.length > 1 && (
              <select value={game} onChange={(e) => setGame(e.target.value as GameVariant | 'all')} aria-label="Jeu">
                {games.map((g) => <option key={g} value={g}>{VARIANT_FR[g]}</option>)}
                <option value="all">Tous les jeux</option>
              </select>
            )}
          {tab !== 'tourneys' && (
            <>
              <select value={mode} onChange={(e) => setMode(e.target.value as ModeFilter)} aria-label="Mode">
                <option value="all">Cash et tournoi</option>
                <option value="cash">Cash game</option>
                <option value="tournament">Tournoi</option>
              </select>
              <select value={period} onChange={(e) => setPeriod(Number(e.target.value) as (typeof PERIODS)[number])} aria-label="Période">
                <option value={50}>50 dernières mains</option>
                <option value={200}>200 dernières mains</option>
                <option value={0}>Toutes les mains</option>
              </select>
            </>
          )}
          </div>
        </div>

        {tab === 'stats' &&
          (s.n === 0 ? (
            <p className="empty">Joue quelques mains : tes statistiques et l'analyse de tes décisions apparaîtront ici.</p>
          ) : (
            <>
              <div className="kpis">
                <Kpi label="Mains" value={String(s.n)} />
                <Kpi label="Résultat" value={`${bb(s.netBB)} BB`} tone={s.netBB >= 0 ? 'good' : 'bad'} />
                <Kpi label="Pour 100 mains" value={`${bb(s.bb100)} BB`} tone={s.bb100 >= 0 ? 'good' : 'bad'} />
                <Kpi label="Bonnes décisions" value={s.decisions ? pctTxt(s.grades.good / s.decisions) : '–'} tone="gold" />
              </div>
              <section className="card-block">
                <h3>Évolution de tes gains (en grosses blinds)</h3>
                <Curve points={s.curve} />
              </section>
              <div className="two-cols">
                <section className="card-block">
                  <h3>Ton style de jeu</h3>
                  {s.lines.map((l) => <StatRow key={l.key} l={l} />)}
                  {s.n < 100 && <p className="muted small">Ces chiffres deviennent fiables après une centaine de mains.</p>}
                </section>
                <div className="stack-col">
                  <section className="card-block">
                    <h3>À travailler en priorité</h3>
                    {s.topMistakes.length === 0 ? (
                      <p className="muted small">Aucune erreur récurrente pour l'instant. Bravo !</p>
                    ) : (
                      <ol className="mistakes">
                        {s.topMistakes.map((m) => (
                          <li key={m.tag}>
                            <b>{m.label}</b> <span className="count">×{m.count}</span>
                            <small>{m.tip}</small>
                          </li>
                        ))}
                      </ol>
                    )}
                    <div className="grade-bar" title="Répartition de tes décisions">
                      <i className="g-good" style={{ flex: s.grades.good }} />
                      <i className="g-ok" style={{ flex: s.grades.ok }} />
                      <i className="g-mistake" style={{ flex: s.grades.mistake }} />
                    </div>
                    <p className="muted small">
                      {s.grades.good} bonnes · {s.grades.ok} à améliorer · {s.grades.mistake} erreurs
                    </p>
                  </section>
                  <section className="card-block">
                    <h3>Gains par position</h3>
                    <Positions rows={s.positions} />
                  </section>
                </div>
              </div>
            </>
          ))}

        {tab === 'hands' &&
          (hands.length === 0 ? (
            <p className="empty">Aucune main enregistrée pour l'instant.</p>
          ) : (
            <ul className="hand-list">
              {[...hands].reverse().map((h) => {
                const g = { good: 0, ok: 0, mistake: 0 };
                for (const d of h.decisions ?? []) g[d.grade]++;
                return (
                  <li key={h.id}>
                    <button onClick={() => setOpen(h)}>
                      <span className="hl-cards">{h.heroCards.map((c) => <CardView key={c} card={c} size="sm" />)}</span>
                      <span className="hl-main">
                        <span><b>{handNameFor(h.heroCards)}</b> · {POS_SHORT[h.heroPos.replace('*', '')] ?? h.heroPos}</span>
                        <small>
                          {new Date(h.ts).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {h.game === 'omaha' ? 'Omaha · ' : ''}{h.mode === 'cash' ? 'Cash' : 'Tournoi'}
                        </small>
                      </span>
                      <span className="hl-grades">
                        {g.mistake > 0 && <span className="g-mistake">! {g.mistake}</span>}
                        {g.ok > 0 && <span className="g-ok">~ {g.ok}</span>}
                      </span>
                      <span className={`hl-net ${h.net > 0 ? 'good' : h.net < 0 ? 'bad' : ''}`}>{bb(h.net / h.bb)} BB</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ))}

        {tab === 'tourneys' &&
          (t.n === 0 ? (
            <p className="empty">Aucun tournoi terminé pour l'instant.</p>
          ) : (
            <>
              <div className="kpis">
                <Kpi label="Tournois" value={String(t.n)} />
                <Kpi label="Victoires" value={String(t.wins)} tone="gold" />
                <Kpi label="Dans l'argent" value={pctTxt(t.itm / t.n)} tone="good" />
                <Kpi label="Place moyenne" value={t.avg.toFixed(1).replace('.', ',')} />
              </div>
              <ul className="hand-list">
                {[...tourneys].reverse().map((x, i) => (
                  <li key={i}>
                    <div className="row-static">
                      <span className={`t-place ${x.place === 1 ? 'gold' : ''}`}>{ordinalFR(x.place)}</span>
                      <span className="hl-main">
                        <span>sur {x.players} joueurs · niveau {x.level}</span>
                        <small>{new Date(x.ts).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {x.hands} mains</small>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ))}

        {(all.length > 0 || tourneys.length > 0) && (
          <p className="reset">
            <button
              className="ghost"
              onClick={() => {
                if (window.confirm('Effacer tout l’historique et les statistiques ? Cette action est définitive.')) {
                  clearHistory();
                  setVersion((v) => v + 1);
                }
              }}
            >
              Effacer l'historique
            </button>
          </p>
        )}
      </div>
      {open && <HandReview record={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'gold' }) {
  return (
    <div className={`kpi ${tone ?? ''}`}>
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
}

function StatRow({ l }: { l: StatLine }) {
  const v = l.value;
  const fmt = (x: number) => (l.unit === '%' ? pctTxt(x) : x.toFixed(1).replace('.', ','));
  const where = v === null ? null : v < l.lo ? 'low' : v > l.hi ? 'high' : 'ok';
  return (
    <div className="stat-row">
      <div className="stat-head">
        <span>{l.label}</span>
        <b className={where === 'ok' ? 'good' : where ? 'warn' : 'muted'}>{v === null ? '–' : fmt(v)}</b>
      </div>
      <div className="gauge">
        <span className="zone" style={{ left: `${(l.lo / l.max) * 100}%`, width: `${((l.hi - l.lo) / l.max) * 100}%` }} />
        {v !== null && <i style={{ left: `${Math.min(1, v / l.max) * 100}%` }} />}
      </div>
      <small>
        {l.explain} Zone conseillée : {fmt(l.lo)} à {fmt(l.hi)}.{' '}
        {where === 'low' && <em>{l.low}</em>}
        {where === 'high' && <em>{l.high}</em>}
      </small>
    </div>
  );
}

function Curve({ points }: { points: number[] }) {
  if (points.length < 2) return <p className="muted small">La courbe apparaît après quelques mains.</p>;
  const W = 600;
  const H = 160;
  const min = Math.min(0, ...points);
  const max = Math.max(0, ...points);
  const span = max - min || 1;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / span) * (H - 16) - 8;
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <svg className="curve" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Gains cumulés : ${bb(last)} BB`}>
      <line x1="0" x2={W} y1={y(0)} y2={y(0)} className="zero" />
      <path d={`${d} L${W},${y(0)} L0,${y(0)} Z`} className={`area ${last >= 0 ? 'up' : 'down'}`} />
      <path d={d} className={`line ${last >= 0 ? 'up' : 'down'}`} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Positions({ rows }: { rows: { pos: string; n: number; net: number }[] }) {
  const m = Math.max(1, ...rows.map((r) => Math.abs(r.net / r.n)));
  return (
    <div className="positions">
      {rows.map((r) => {
        const avg = r.net / r.n;
        return (
          <div key={r.pos} className="pos-row">
            <span>{POS_SHORT[r.pos] ?? r.pos}</span>
            <div className="pos-bar">
              <i className={avg >= 0 ? 'up' : 'down'} style={{ width: `${(Math.abs(avg) / m) * 50}%`, [avg >= 0 ? 'left' : 'right']: '50%' }} />
            </div>
            <b className={avg >= 0 ? 'good' : 'bad'}>{bb(avg)}</b>
            <small>{r.n} m.</small>
          </div>
        );
      })}
      <p className="muted small">Moyenne en BB par main. On gagne naturellement plus au bouton et on perd un peu dans les blinds.</p>
    </div>
  );
}
