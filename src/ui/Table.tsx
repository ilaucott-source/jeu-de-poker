import { useEffect, useMemo, useRef, useState } from 'react';
import { evaluateBest, describeHand } from '../engine/evaluator';
import { legalActions, potTotal } from '../engine/holdem';
import { avatarFor, HERO_ID, useCashGame, type CashGameOptions } from '../game/useCashGame';
import { CardView } from './CardView';
import { useDecisionTimer } from '../game/timer';
import { BetPanel } from './BetPanel';
import { isMuted, playCheck, playChips, playDeal, playFold, playWin, setMuted, unlockAudio } from '../game/sound';

const STRUCTURE_FR = { NL: 'No Limit', PL: 'Pot Limit', FL: 'Limit' };
const ACTION_FR: Record<string, string> = { fold: 'Couché', check: 'Parole', call: 'Suit', bet: 'Mise', raise: 'Relance', post: 'Blind' };

export function Table({ options, onQuit }: { options: CashGameOptions; onQuit: () => void }) {
  const { hand, handNo, deal, act, rebuy, heroStack } = useCashGame(options);
  const legal = hand ? legalActions(hand) : null;
  const heroTurn = hand?.toAct !== null && hand?.players[hand.toAct!]?.id === HERO_ID;
  const [muted, setMutedState] = useState(isMuted());
  const bb = options.bigBlind;

  const lastAction = useMemo(() => {
    const m: Record<string, string> = {};
    if (!hand) return m;
    for (const a of hand.log) if (a.street === hand.street || hand.street === 'complete') m[a.playerId] = ACTION_FR[a.type] + (a.amount && a.type !== 'post' ? ` ${a.amount}` : '');
    return m;
  }, [hand]);

  const hero = hand?.players.find((p) => p.id === HERO_ID);
  const heroHand = hero && hand && hand.board.length >= 3 && !hero.folded ? describeHand(evaluateBest([...hero.holeCards, ...hand.board])) : null;
  const done = !hand || hand.street === 'complete';
  const timer = useDecisionTimer(options.timer, !!heroTurn && !done, `${handNo}-${hand?.log.length ?? 0}`, handNo, () => {
    const l = hand ? legalActions(hand) : null;
    if (!l) return;
    act(l.canCheck ? { type: 'check' } : { type: 'fold' });
  });

  // Sons : on joue chaque nouvelle action du journal
  const heard = useRef({ hand: -1, count: 0, won: false });
  useEffect(() => {
    if (!hand) return;
    const h = heard.current;
    if (h.hand !== handNo) {
      heard.current = { hand: handNo, count: 0, won: false };
      playDeal();
    }
    const fresh = hand.log.slice(heard.current.count);
    heard.current.count = hand.log.length;
    const last = fresh.filter((a) => a.type !== 'post').pop();
    if (fresh.some((a) => a.type === 'post') && !last) playChips(2);
    if (last) {
      if (last.type === 'fold') playFold();
      else if (last.type === 'check') playCheck();
      else playChips(2 + Math.round(Math.log2(1 + last.amount / bb)));
    }
    if (hand.street === 'complete' && !heard.current.won) {
      heard.current.won = true;
      setTimeout(playWin, 450);
    }
  }, [hand, handNo, bb]);

  return (
    <div className="table-screen" onPointerDown={unlockAudio}>
      <div className="rotate-hint" role="alert">
        <div className="phone" aria-hidden="true" />
        <p>Tourne ton téléphone pour jouer</p>
        <small>La table s'affiche en paysage.</small>
      </div>
      <header className="topbar">
        <button className="ghost" onClick={onQuit}>← Menu</button>
        <span>Cash game · {STRUCTURE_FR[options.structure]} · {bb / 2}/{bb}</span>
        <span className="top-right">
          Main n°{handNo}{timer.enabled && <> · Banque {Math.ceil(timer.bank)} s</>}
          <button className="ghost sound" aria-label={muted ? 'Activer le son' : 'Couper le son'} onClick={() => { setMuted(!muted); setMutedState(!muted); }}>
            {muted ? '🔇' : '🔊'}
          </button>
        </span>
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
                  {p.holeCards.map((c, k) => <CardView key={`${handNo}-${k}`} card={c} hidden={!reveal} size={isHero ? 'lg' : 'sm'} delay={k * 120} />)}
                </div>
                {isHero && heroTurn && timer.enabled && (
                  <div className={`timer ${timer.urgent ? 'urgent' : ''} ${timer.usingBank ? 'bank' : ''}`}>
                    <div className="timer-fill" style={{ width: `${timer.fraction * 100}%` }} />
                    <span>{timer.usingBank ? 'Banque ' : ''}{Math.ceil(timer.remaining)} s</span>
                  </div>
                )}
                <div className="plate">
                  {avatarFor(p.name) ? <img className="avatar" src={avatarFor(p.name)!} alt="" /> : <div className="avatar me">♠</div>}
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
            {[0, 1, 2, 3, 4].map((k) => (hand?.board[k] ? <CardView key={`${handNo}-b${k}`} card={hand.board[k]} size="md" delay={k < 3 ? k * 90 : 0} /> : <div key={k} className="card slot md" />))}
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
          <BetPanel hand={hand!} legal={legal} allIn={hero!.stack + hero!.bet} onAct={act} />
        ) : (
          <span className="waiting">Les adversaires réfléchissent…</span>
        )}
      </footer>
    </div>
  );
}
