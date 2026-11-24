import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { evaluateBest, describeHand } from '../engine/evaluator';
import { legalActions, potTotal } from '../engine/holdem';
import { avatarFor, HERO_ID, useCashGame, type CashGameOptions } from '../game/useCashGame';
import { CardView } from './CardView';
import { useDecisionTimer } from '../game/timer';
import { BetPanel } from './BetPanel';
import { OddsPanel } from './OddsPanel';
import { ChipStack, FlyingChips, type Flight } from './chips';
import { ordinalFR } from '../game/tournament';
import { TourneyEnd } from './TourneyEnd';
import { HandReview } from './HandReview';
import { loadHands, type HandRecord } from '../game/history';
import { betPos, isCompactLandscape, seatPos } from './layout';
import { isMuted, playBoard, playCheck, playChips, playDeal, playFold, playWin, setMuted, unlockAudio } from '../game/sound';

const STRUCTURE_FR = { NL: 'No Limit', PL: 'Pot Limit', FL: 'Limit' };
const ACTION_FR: Record<string, string> = { fold: 'Couché', check: 'Parole', call: 'Suit', bet: 'Mise', raise: 'Relance', post: 'Blind' };

export function Table({ options, onQuit, onReplay }: { options: CashGameOptions; onQuit: () => void; onReplay: () => void }) {
  const game = useCashGame(options);
  const { hand, handNo, deal, act, rebuy, heroStack } = game;
  const tourney = options.mode === 'tournament';
  const [toast, setToast] = useState<string | null>(null);
  const [review, setReview] = useState<HandRecord | null>(null);
  const seenElim = useRef(0);
  useEffect(() => {
    const fresh = game.eliminated.slice(seenElim.current).filter((e) => e.id !== HERO_ID);
    seenElim.current = game.eliminated.length;
    if (!fresh.length) return;
    setToast(fresh.map((e) => `${e.name} est éliminé · ${ordinalFR(e.place)}`).join(' — '));
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [game.eliminated]);
  const legal = hand ? legalActions(hand) : null;
  const heroTurn = hand?.toAct !== null && hand?.players[hand.toAct!]?.id === HERO_ID;
  const [muted, setMutedState] = useState(isMuted());
  const [showOdds, setShowOdds] = useState(() => {
    try {
      return localStorage.getItem('poker-odds') === '1';
    } catch {
      return false;
    }
  });
  const toggleOdds = () => {
    setShowOdds((v) => {
      try {
        localStorage.setItem('poker-odds', v ? '0' : '1');
      } catch {
        /* réglage gardé en mémoire */
      }
      return !v;
    });
  };
  const bb = hand?.config.bigBlind ?? game.level.bb;

  const [raiseTo, setRaiseTo] = useState<number | null>(null);
  const lastAction = useMemo(() => {
    const m: Record<string, string> = {};
    const kind: Record<string, string> = {};
    if (!hand) return { text: m, kind };
    for (const a of hand.log) {
      if (a.street !== hand.street && hand.street !== 'complete') continue;
      if (a.type === 'post') m[a.playerId] = a.label === 'petite blind' ? `SB ${a.amount}` : a.label === 'grosse blind' ? `BB ${a.amount}` : `Ante ${a.amount}`;
      else m[a.playerId] = ACTION_FR[a.type] + (a.amount ? ` ${a.amount}` : '');
      kind[a.playerId] = a.type;
    }
    return { text: m, kind };
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
  const heard = useRef({ hand: -1, count: 0, won: false, board: 0 });
  useEffect(() => {
    if (!hand) return;
    const h = heard.current;
    if (h.hand !== handNo) {
      heard.current = { hand: handNo, count: 0, won: false, board: 0 };
      playDeal();
    }
    const fresh = hand.log.slice(heard.current.count);
    heard.current.count = hand.log.length;
    const last = fresh.filter((a) => a.type !== 'post').pop();
    if (fresh.some((a) => a.type === 'post') && !last) playChips(1);
    if (last) {
      if (last.type === 'fold') playFold();
      else if (last.type === 'check') playCheck();
      else playChips(last.amount / bb);
    }
    if (hand.board.length > heard.current.board && hand.street !== 'complete') {
      playBoard(hand.board.length - heard.current.board);
    }
    heard.current.board = hand.board.length;
    if (hand.street === 'complete' && !heard.current.won) {
      heard.current.won = true;
      setTimeout(playWin, 1050);
    }
  }, [hand, handNo, bb]);

  // Disposition (bureau ou téléphone en paysage)
  const [compact, setCompact] = useState(isCompactLandscape());
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape) and (max-height: 520px)');
    const on = () => setCompact(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // Position réelle du pot sur le tapis, pour viser les jetons
  const feltRef = useRef<HTMLDivElement>(null);
  const potRef = useRef<HTMLDivElement>(null);
  const potAt = useRef<[number, number]>([50, 55]);
  useLayoutEffect(() => {
    const f = feltRef.current?.getBoundingClientRect();
    const p = potRef.current?.getBoundingClientRect();
    if (f && p && f.width) potAt.current = [((p.left + p.width / 2 - f.left) / f.width) * 100, ((p.top + p.height / 2 - f.top) / f.height) * 100];
  });

  // Jetons en mouvement : mises ramassées au centre, puis pot envoyé au gagnant
  const [flights, setFlights] = useState<Flight[]>([]);
  const flightId = useRef(0);
  const prevHand = useRef<{ no: number; street: string; bets: number[] } | null>(null);
  useEffect(() => {
    if (!hand) return;
    const n = hand.players.length;
    const prev = prevHand.current;
    const add: Flight[] = [];
    if (prev && prev.no === handNo && prev.street !== hand.street) {
      prev.bets.forEach((b, i) => {
        if (b > 0) add.push({ id: ++flightId.current, amount: b, from: betPos(n, i, compact), to: potAt.current, delay: 0 });
      });
      if (hand.street === 'complete' && hand.results) {
        for (const r of hand.results)
          for (const [id, amt] of Object.entries(r.shares)) {
            const i = hand.players.findIndex((p) => p.id === id);
            add.push({ id: ++flightId.current, amount: amt, from: potAt.current, to: seatPos(n, i, compact), delay: add.length ? 550 : 250 });
          }
      }
    }
    prevHand.current = { no: handNo, street: hand.street, bets: hand.players.map((p) => p.bet) };
    if (add.length) setFlights((f) => [...f, ...add]);
  }, [hand, handNo, compact]);
  const landed = useCallback((id: number) => setFlights((f) => f.filter((x) => x.id !== id)), []);
  const unit = bb / 2;
  const collected = hand && !done ? hand.players.reduce((s, p) => s + p.committed - p.bet, 0) : 0;
  const nSeats = hand?.players.length ?? options.bots + 1;

  return (
    <div className={`table-screen ${showOdds ? 'with-stats' : ''} ${tourney ? 'tourney' : ''}`} onPointerDown={unlockAudio}>
      <div className="rotate-hint" role="alert">
        <div className="phone" aria-hidden="true" />
        <p>Tourne ton téléphone pour jouer</p>
        <small>La table s'affiche en paysage.</small>
      </div>
      <header className="topbar">
        <button className="pill" onClick={onQuit}>‹ Menu</button>
        <span className="title">
          {tourney ? (
            <>
              <b>Tournoi</b> · Niveau {game.levelIndex + 1} · {game.level.sb}/{game.level.bb}
              {game.level.ante > 0 && <> · ante {game.level.ante}</>}
              <span className="bank"> · hausse dans {game.handsLeftInLevel + 1} main{game.handsLeftInLevel ? 's' : ''}</span> · {game.alive}/{game.total} joueurs
            </>
          ) : (
            <>
              <b>{STRUCTURE_FR[options.structure]}</b> · Blinds {bb / 2}/{bb} · Main n°{handNo}
            </>
          )}
          {timer.enabled && <span className="bank"> · Banque {Math.ceil(timer.bank)} s</span>}
        </span>
        <span className="top-right">
          <button className={`pill stats-btn ${showOdds ? 'on' : ''}`} onClick={toggleOdds} aria-pressed={showOdds}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 14V9h3v5zm4.5 0V5h3v9zM11 14V2h3v12z" fill="currentColor" /></svg>
            Stats
          </button>
          <button className="pill icon" aria-label={muted ? 'Activer le son' : 'Couper le son'} onClick={() => { setMuted(!muted); setMutedState(!muted); }}>
            {muted ? '🔇' : '🔊'}
          </button>
        </span>
      </header>

      <main className="stage">
      {showOdds && (hand ? <OddsPanel hand={hand} heroId={HERO_ID} raiseTo={heroTurn ? raiseTo : null} onClose={toggleOdds} /> : <aside className="odds-panel"><p className="muted">Distribue une main pour voir tes statistiques.</p></aside>)}
      <div className="rail">
      <div className="felt" ref={feltRef}>
        <div className={`seats n${nSeats} ${nSeats >= 8 ? 'crowded' : ''}`}>
          {(hand?.players ?? []).map((p, i) => {
            const isHero = p.id === HERO_ID;
            const reveal = isHero || (hand!.showdown && hand!.showdown[p.id]);
            const won = hand!.results?.reduce((s, r) => s + (r.shares[p.id] ?? 0), 0) ?? 0;
            return (
              <div key={p.id} style={{ left: `${seatPos(nSeats, i, compact)[0]}%`, top: `${seatPos(nSeats, i, compact)[1]}%` }} className={`seat pos${i} ${!p.folded && !p.out && hand!.street !== 'complete' ? 'in-hand' : ''} ${p.allIn && !p.folded ? 'allin' : ''} ${seatPos(nSeats, i, compact)[0] > 50 ? 'right' : seatPos(nSeats, i, compact)[0] < 50 ? 'left' : 'mid'} ${p.folded ? 'folded' : ''} ${hand!.toAct === i ? 'active' : ''} ${isHero ? 'hero' : ''} ${p.out ? 'out' : ''}`}>
                <div className="hole">
                  {p.holeCards.map((c, k) => <CardView key={`${handNo}-${k}`} card={c} hidden={!reveal} size={isHero ? 'lg' : 'sm'} delay={k * 120} />)}
                </div>
                {isHero && heroTurn && timer.enabled && (
                  <div className={`timer ${timer.urgent ? 'urgent' : ''} ${timer.usingBank ? 'bank' : ''}`}>
                    <div className="timer-fill" style={{ width: `${timer.fraction * 100}%` }} />
                    <span>{timer.usingBank ? 'Banque ' : ''}{Math.ceil(timer.remaining)} s</span>
                  </div>
                )}
                <div className="plate-row">
                <ChipStack amount={p.stack} unit={unit} mode="stack" small={compact} />
                <div className="plate">
                  {avatarFor(p.name) ? <img className="avatar" src={avatarFor(p.name)!} alt="" /> : <div className="avatar me">♠</div>}
                  <div className="name">{p.name}</div>
                  {hand!.toAct === i && !isHero && <span className="thinking" aria-label="réfléchit"><i /><i /><i /></span>}
                  <div className="stack">{p.stack}</div>
                  <div className="markers">
                  {hand!.config.buttonIndex === i && <span className="marker dealer-btn" title="Bouton du donneur">D</span>}
                  {hand!.sbIndex === i && <span className="marker sb" title="Petite blind">SB</span>}
                  {hand!.bbIndex === i && <span className="marker bb" title="Grosse blind">BB</span>}
                </div>
                </div>
                </div>
                {p.out && <div className="last k-out">Éliminé</div>}
                {p.allIn && !p.folded && <div className="last allin-tag">TAPIS</div>}
                {lastAction.text[p.id] && !won && !(p.allIn && !p.folded) && <div className={`last k-${lastAction.kind[p.id]}`}>{lastAction.text[p.id]}</div>}
                {won > 0 && <div className="last win">+{won}</div>}
              </div>
            );
          })}
        </div>
        <div className="bets-layer">
          {(hand?.players ?? []).map((p, i) =>
            p.bet > 0 ? (
              <div key={p.id} className="bet-spot" style={{ left: `${betPos(nSeats, i, compact)[0]}%`, top: `${betPos(nSeats, i, compact)[1]}%` }}>
                <ChipStack amount={p.bet} unit={unit} small label />
              </div>
            ) : null,
          )}
          {flights.map((f) => <FlyingChips key={f.id} f={f} unit={unit} onDone={landed} />)}
        </div>
        <div className="center">
          <div className="board">
            {[0, 1, 2, 3, 4].map((k) => (hand?.board[k] ? <CardView key={`${handNo}-b${k}`} card={hand.board[k]} size="md" delay={k < 3 ? k * 90 : 0} /> : <div key={k} className="card slot md" />))}
          </div>
          <div className="pot-row">
            <div className="pot-chips" ref={potRef}>{collected > 0 && <ChipStack amount={collected} unit={unit} small={compact} />}</div>
            {hand && !done && <div className="pot"><small>Pot</small> {potTotal(hand)}</div>}
            {hand && !done && <div className="inplay">{hand.players.filter((p) => !p.folded && !p.out).length} en jeu</div>}
          </div>
          {hand?.showdown && hero && hand.showdown[HERO_ID] && <div className="pot">Ta main : {describeHand(hand.showdown[HERO_ID])}</div>}
          {!hand?.showdown && heroHand && <div className="pot hint">Ta main : {heroHand}</div>}
        </div>
      </div>

      </div>
      </main>

      {toast && <div className="toast" role="status">{toast}</div>}
      {tourney && game.tourneyOver && game.heroPlace && (!hand || hand.street === 'complete') && (
        <TourneyEnd place={game.heroPlace} total={game.total} hands={handNo} level={game.levelIndex + 1} eliminated={game.eliminated} onReplay={onReplay} onQuit={onQuit} />
      )}

      {review && <HandReview record={review} onClose={() => setReview(null)} />}
      <footer className="actions">
        {done ? (
          tourney && game.tourneyOver ? (
            <button className="primary" onClick={onReplay}>Rejouer un tournoi</button>
          ) : heroStack <= 0 && !tourney ? (
            <button className="primary" onClick={() => { rebuy(); deal(); }}>Se recaver et rejouer</button>
          ) : (
            <div className="done-actions">
              {game.lastRecordId && hand && (
                <button className="pill review-btn" onClick={() => setReview(loadHands().find((h) => h.id === game.lastRecordId) ?? null)}>
                  Analyse de la main
                </button>
              )}
              <button className="primary" onClick={deal}>{hand ? 'Main suivante' : 'Distribuer'}</button>
            </div>
          )
        ) : heroTurn && legal ? (
          <BetPanel hand={hand!} legal={legal} allIn={hero!.stack + hero!.bet} onAct={act} onAmount={setRaiseTo} />
        ) : (
          <span className="waiting">Les adversaires réfléchissent…</span>
        )}
      </footer>
    </div>
  );
}
