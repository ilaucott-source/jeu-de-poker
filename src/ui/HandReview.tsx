import { useMemo } from 'react';
import { analyzeHand, ANALYSIS_VERSION, replay, type Decision } from '../engine/analysis';
import { describeHand } from '../engine/evaluator';
import { bestHand, handNameFor } from '../engine/variant';
import { omahaLabel } from '../engine/omaha';
import type { Street } from '../engine/holdem';
import { POSITION_FR } from '../engine/ranges';
import { updateHand, type HandRecord } from '../game/history';
import { CardView } from './CardView';

const STREET_FR: Record<string, string> = { preflop: 'Avant le flop', flop: 'Flop', turn: 'Turn', river: 'River' };
const STREET_27: Record<string, string> = { preflop: 'Avant le 1er tirage', flop: '1er tirage', turn: '2e tirage', river: '3e tirage' };
const GRADE_FR = { good: 'Bonne décision', ok: 'À améliorer', mistake: 'Erreur' };
const fmtBB = (x: number) => `${x > 0 ? '+' : ''}${Math.round(x * 10) / 10} BB`;

/** Revoir une main : chaque action, rue par rue, avec l'analyse de tes décisions. */
export function HandReview({ record, onClose }: { record: HandRecord; onClose: () => void }) {
  const data = useMemo(() => {
    const states = replay(record.script);
    const draw27 = record.game === 'draw27';
    const fresh = record.decisions && record.analysisV === ANALYSIS_VERSION;
    const decisions: Decision[] = fresh ? record.decisions! : analyzeHand(record.script, record.heroId, 400);
    if (!fresh) {
      try {
        updateHand(record.id, { decisions, analysisV: ANALYSIS_VERSION });
      } catch {
        /* l'analyse reste affichée même si on ne peut pas l'enregistrer */
      }
    }
    const byAt = new Map(decisions.map((d) => [d.at, d]));
    const final = states[states.length - 1];
    const streets: { street: Street; board: string[]; lines: { who: string; hero: boolean; text: string; d?: Decision }[] }[] = [];
    record.script.actions.forEach((a, k) => {
      const st = states[k];
      if (st.toAct === null) return;
      const p = st.players[st.toAct];
      let block = streets[streets.length - 1];
      if (!block || block.street !== st.street) {
        block = { street: st.street, board: draw27 ? [] : st.board, lines: [] };
        streets.push(block);
      }
      const text =
        a.type === 'fold'
          ? 'se couche'
          : a.type === 'check'
            ? 'parole'
            : a.type === 'call'
              ? `suit ${Math.min(st.currentBet - p.bet, p.stack)}`
              : a.type === 'draw'
                ? a.discard.length
                  ? `change ${a.discard.length} carte${a.discard.length > 1 ? 's' : ''}`
                  : 'garde ses cartes (servi)'
                : `${st.currentBet === 0 ? 'mise' : 'relance à'} ${a.to}`;
      block.lines.push({ who: p.id === record.heroId ? 'Toi' : p.name, hero: p.id === record.heroId, text, d: byAt.get(k) });
      // 2-7 : après son tirage, on montre la nouvelle main du joueur
      if (draw27 && a.type === 'draw' && p.id === record.heroId) block.board = states[k + 1].players.find((x) => x.id === record.heroId)!.holeCards;
    });
    const shown = final.players.filter((p) => record.shown.includes(p.id) && p.id !== record.heroId);
    const winners = (final.results ?? []).flatMap((r) => Object.entries(r.shares).map(([id, amt]) => ({ name: id === record.heroId ? 'Toi' : final.players.find((p) => p.id === id)!.name, amt })));
    return { decisions, streets, final, shown, winners };
  }, [record]);

  const heroHand = record.board.length >= 3 ? describeHand(bestHand(record.game ?? 'holdem', record.heroCards, record.board)) : null;
  const g = { good: 0, ok: 0, mistake: 0 };
  for (const d of data.decisions) g[d.grade]++;

  return (
    <div className="review-overlay" role="dialog" aria-label="Revoir la main">
      <div className="review">
        <header className="review-head">
          <div className="review-cards">
            {record.heroCards.map((c) => <CardView key={c} card={c} size="sm" />)}
          </div>
          <div className="review-title">
            <b>{record.heroCards.length === 4 ? omahaLabel(record.heroCards) : handNameFor(record.heroCards)}</b> · {POSITION_FR[record.heroPos] ?? record.heroPos}
            <div className={`review-net ${record.net > 0 ? 'good' : record.net < 0 ? 'bad' : ''}`}>
              {record.net > 0 ? '+' : ''}
              {record.net} jetons ({fmtBB(record.net / record.bb)})
            </div>
          </div>
          <div className="review-grades">
            {g.good > 0 && <span className="g-good">✓ {g.good}</span>}
            {g.ok > 0 && <span className="g-ok">~ {g.ok}</span>}
            {g.mistake > 0 && <span className="g-mistake">! {g.mistake}</span>}
          </div>
          <button className="pill" onClick={onClose}>Fermer</button>
        </header>

        <div className="review-body">
          {data.streets.map((b) => (
            <section key={b.street} className="review-street">
              <h4>
                {(record.game === 'draw27' ? STREET_27 : STREET_FR)[b.street] ?? b.street}
                {b.board.length > 0 && (
                  <span className="review-board">
                    {b.board.map((c) => <CardView key={c} card={c as never} size="sm" />)}
                  </span>
                )}
              </h4>
              <ul>
                {b.lines.map((l, i) => (
                  <li key={i} className={l.hero ? 'me' : ''}>
                    <span className="who">{l.who}</span> {l.text}
                    {l.d && (
                      <div className={`advice g-${l.d.grade}`}>
                        <b>{GRADE_FR[l.d.grade]} · </b>
                        {l.d.title}
                        <small>{l.d.detail}</small>
                        {l.d.stage && <small className="stage-tag">{l.d.stage}</small>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <section className="review-street">
            <h4>
              Résultat
              {data.final.board.length > 0 && (
                <span className="review-board">
                  {data.final.board.map((c) => <CardView key={c} card={c} size="sm" />)}
                </span>
              )}
            </h4>
            <ul>
              {heroHand && <li className="me"><span className="who">Toi</span> {heroHand}</li>}
              {data.shown.map((p) => (
                <li key={p.id}>
                  <span className="who">{p.name}</span>
                  <span className="inline-cards">{p.holeCards.map((c) => <CardView key={c} card={c} size="sm" />)}</span>
                  {data.final.showdown?.[p.id] && describeHand(data.final.showdown[p.id])}
                </li>
              ))}
              {data.winners.map((w, i) => (
                <li key={`w${i}`}>
                  <span className="who">{w.name}</span> remporte {w.amt}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
