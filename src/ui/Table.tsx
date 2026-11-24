import { useMemo, useState } from 'react';
import { evaluateBest, describeHand } from '../engine/evaluator';
import { legalActions, potTotal } from '../engine/holdem';
import { HERO_ID, useCashGame, type CashGameOptions } from '../game/useCashGame';
import { CardView } from './CardView';

const STRUCTURE_FR = { NL: 'No Limit', PL: 'Pot Limit', FL: 'Limit' };
const ACTION_FR: Record<string, string> = { fold: 'Couché', check: 'Parole', call: 'Suit', bet: 'Mise', raise: 'Relance', post: 'Blind' };

export function Table({ options, onQuit }: { options: CashGameOptions; onQuit: () => void }) {
  const { hand, handNo, deal, act, rebuy, heroStack } = useCashGame(options);
  const legal = hand ? legalActions(hand) : null;
  const heroTurn = hand?.toAct !== null && hand?.players[hand.toAct!]?.id === HERO_ID;
  const [raiseTo, setRaiseTo] = useState(0);
  const bb = options.bigBlind;

  const lastAction = useMemo(() => {
    const m: Record<string, string> = {};
    if (!hand) return m;
    for (const a of hand.log) if (a.street === hand.street || hand.street === 'complete') m[a.playerId] = ACTION_FR[a.type] + (a.amount && a.type !== 'post' ? ` ${a.amount}` : '');
    return m;
  }, [hand]);

  const hero = hand?.players.find((p) => p.id === HERO_ID);
  const heroHand = hero && hand && hand.board.length >= 3 && !hero.folded ? describeHand(evaluateBest([...hero.holeCards, ...hand.board])) : null;
  const value = legal ? Math.min(Math.max(raiseTo || legal.minTo, legal.minTo), legal.maxTo) : 0;
  const done = !hand || hand.street === 'complete';

  return (
    <div className="table-screen">
      <header className="topbar">
        <button className="ghost" onClick={onQuit}>← Menu</button>
        <span>Cash game · {STRUCTURE_FR[options.structure]} · {bb / 2}/{bb}</span>
        <span>Main n°{handNo}</span>
      </header>

      <div className="felt">
        <div className={`seats n${(hand?.players.length ?? options.bots + 1)}`}>
          {(hand?.players ?? []).map((p, i) => {
            const isHero = p.id === HERO_ID;
            const reveal = isHero || (hand!.showdown && hand!.showdown[p.id]);
            const won = hand!.results?.reduce((s, r) => s + (r.shares[p.id] ?? 0), 0) ?? 0;
            return (
              <div key={p.id} className={`seat pos${i} ${p.folded ? 'folded' : ''} ${hand!.toAct === i ? 'active' : ''} ${isHero ? 'hero' : ''}`}>
                <div className="hole">
                  {p.holeCards.map((c, k) => <CardView key={k} card={c} hidden={!reveal} small={!isHero} />)}
                </div>
                <div className="plate">
                  <div className="name">{p.name}{hand!.config.buttonIndex === i && <span className="dealer">D</span>}</div>
                  <div className="stack">{p.stack}</div>
                </div>
                {lastAction[p.id] && !won && <div className="last">{lastAction[p.id]}</div>}
                {won > 0 && <div className="last win">+{won}</div>}
                {p.bet > 0 && <div className="bet">{p.bet}</div>}
              </div>
            );
          })}
        </div>
        <div className="center">
          <div className="board">
            {[0, 1, 2, 3, 4].map((k) => (hand?.board[k] ? <CardView key={k} card={hand.board[k]} /> : <div key={k} className="card slot" />))}
          </div>
          {hand && !done && <div className="pot">Pot : {potTotal(hand)}</div>}
          {hand?.showdown && hero && hand.showdown[HERO_ID] && <div className="pot">Ta main : {describeHand(hand.showdown[HERO_ID])}</div>}
          {!hand?.showdown && heroHand && <div className="pot hint">Ta main : {heroHand}</div>}
        </div>
      </div>

      <footer className="actions">
        {done ? (
          heroStack <= 0 ? (
            <button className="primary" onClick={() => { rebuy(); deal(); }}>Se recaver et rejouer</button>
          ) : (
            <button className="primary" onClick={deal}>{hand ? 'Main suivante' : 'Distribuer'}</button>
          )
        ) : heroTurn && legal ? (
          <>
            {legal.canFold && <button onClick={() => act({ type: 'fold' })}>Se coucher</button>}
            {legal.canCheck ? (
              <button onClick={() => act({ type: 'check' })}>Parole</button>
            ) : (
              <button onClick={() => act({ type: 'call' })}>Suivre {legal.callAmount}</button>
            )}
            {legal.canBetOrRaise && (
              <div className="raise">
                {legal.maxTo > legal.minTo && (
                  <input type="range" min={legal.minTo} max={legal.maxTo} step={1} value={value} onChange={(e) => setRaiseTo(Number(e.target.value))} />
                )}
                <button className="primary" onClick={() => { act({ type: legal.isBet ? 'bet' : 'raise', to: value }); setRaiseTo(0); }}>
                  {legal.isBet ? 'Miser' : 'Relancer à'} {value}{value === hero!.stack + hero!.bet ? ' (tapis)' : ''}
                </button>
              </div>
            )}
          </>
        ) : (
          <span className="waiting">Les adversaires réfléchissent…</span>
        )}
      </footer>
    </div>
  );
}
