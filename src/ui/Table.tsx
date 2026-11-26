import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { describeHand } from '../engine/evaluator';
import { bestHand, variantOf } from '../engine/variant';
import { isDrawing } from '../engine/holdem';
import { planDraw } from '../engine/lowball';
import { drawsLeft } from '../engine/draw27';
import { DrawPanel } from './DrawPanel';
import { legalActions, potTotal } from '../engine/holdem';
import { avatarFor, HERO_ID, useCashGame, type CashGameOptions } from '../game/useCashGame';
import { CardView } from './CardView';
import { useDecisionTimer } from '../game/timer';
import { BetPanel } from './BetPanel';
import { OddsPanel } from './OddsPanel';
import { ChipStack, FlyingChips, type Flight } from './chips';
import { ordinalFR } from '../game/tournament';
import { TourneyEnd } from './TourneyEnd';
import type { SavedGame } from '../game/save';
import { HandReview } from './HandReview';
import { loadHands, type HandRecord } from '../game/history';
import { betPos, isCompactLandscape, seatPos } from './layout';
import { isMuted, playBoard, playCheck, playChips, playDeal, playFold, playWin, setMuted, unlockAudio } from '../game/sound';

const STRUCTURE_FR = { NL: 'No Limit', PL: 'Pot Limit', FL: 'Limit' };
const GAME_SHORT = { holdem: '', omaha: 'Omaha ', draw27: '2-7 Triple Draw · ' };
const ACTION_FR: Record<string, string> = { fold: 'Couché', check: 'Parole', call: 'Suit', bet: 'Mise', raise: 'Relance', post: 'Blind', draw: 'Change' };
const DRAW_STAGE = { preflop: 'Avant le 1er tirage', flop: '1er tirage', turn: '2e tirage', river: '3e et dernier tirage' } as Record<string, string>;

export type TableGame = ReturnType<typeof useCashGame>;

/** Infos en plus quand la table se joue entre amis. */
export interface OnlineTableInfo {
  code: string;
  isHost: boolean;
  nextDealAt: number | null;
  paused: boolean;
  setPaused: (p: boolean) => void;
  /** l'hôte joue pour ce joueur (il n'a pas répondu à temps) */
  away: boolean;
  back: () => void;
  hostAway: boolean;
  hostName: string;
  error: string | null;
  /** sièges absents */
  awayIds: string[];
  /** ce joueur attend une place (arrivé en cours de partie) */
  spectator: boolean;
}

export function Table({ options, onQuit, onReplay, resume }: { options: CashGameOptions; onQuit: () => void; onReplay: () => void; resume?: SavedGame | null }) {
  const game = useCashGame(options, resume);
  return <TableView options={options} onQuit={onQuit} onReplay={onReplay} game={game} />;
}

export function TableView({ options, onQuit, onReplay, game, online }: { options: CashGameOptions; onQuit: () => void; onReplay: () => void; game: TableGame; online?: OnlineTableInfo }) {
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
      else if (a.type === 'draw') m[a.playerId] = a.amount ? `Change ${a.amount}` : 'Servi';
      else m[a.playerId] = ACTION_FR[a.type] + (a.amount ? ` ${a.amount}` : '');
      kind[a.playerId] = a.type;
    }
    return { text: m, kind };
  }, [hand]);

  const hero = hand?.players.find((p) => p.id === HERO_ID);
  const draw27 = options.variant === 'draw27';
  const heroHand = hero && hand && (hand.board.length >= 3 || draw27) && !hero.folded && hero.holeCards.length ? describeHand(bestHand(variantOf(hand), hero.holeCards, hand.board)) : null;
  const heroDrawing = !!hand && heroTurn && isDrawing(hand);
  // 2-7 : cartes que le joueur a choisi de jeter
  const [picked, setPicked] = useState<number[]>([]);
  const drawKey = hand ? `${handNo}-${hand.street}-${heroDrawing}` : '';
  useEffect(() => setPicked([]), [drawKey]);
  const togglePick = (k: number) => setPicked((x) => (x.includes(k) ? x.filter((i) => i !== k) : [...x, k]));
  const done = !hand || hand.street === 'complete';
  const timer = useDecisionTimer(options.timer, !!heroTurn && !done, `${handNo}-${hand?.log.length ?? 0}`, handNo, () => {
    if (hand && isDrawing(hand)) {
      // temps écoulé pendant un tirage : on applique le tirage conseillé
      const me = hand.players[hand.toAct!];
      act({ type: 'draw', discard: planDraw(me.holeCards, drawsLeft(hand)) });
      return;
    }
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
      else if (last.type === 'draw') {
        if (last.amount) playDeal();
        else playCheck();
      }
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
    <div className={`table-screen ${showOdds ? 'with-stats' : ''} ${tourney ? 'tourney' : ''} game-${options.variant ?? 'holdem'}`} onPointerDown={unlockAudio}>
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
              <b>{options.variant === 'omaha' ? 'Tournoi Omaha' : 'Tournoi'}</b> · Niveau {game.levelIndex + 1} · {game.level.sb}/{game.level.bb}
              {game.level.ante > 0 && <> · ante {game.level.ante}</>}
              <span className="bank"> · hausse dans {game.handsLeftInLevel + 1} main{game.handsLeftInLevel ? 's' : ''}</span> · {game.alive}/{game.total} joueurs
            </>
          ) : (
            <>
              <b>{GAME_SHORT[options.variant ?? 'holdem']}{STRUCTURE_FR[options.structure]}</b> · Blinds {bb / 2}/{bb} · Main n°{handNo}
            </>
          )}
          {timer.enabled && <span className="bank"> · Banque {Math.ceil(timer.bank)} s</span>}
        </span>
        {online && <span className="pill table-code" title="Code de la table">Table {online.code}</span>}
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
                <div className={`hole n${p.holeCards.length}`}>
                  {p.holeCards.map((c, k) =>
                    isHero && heroDrawing ? (
                      <button key={`${handNo}-${c}`} className={`pick ${picked.includes(k) ? 'on' : ''}`} onClick={() => togglePick(k)} aria-pressed={picked.includes(k)} aria-label={picked.includes(k) ? 'carte à changer' : 'carte gardée'}>
                        <CardView card={c} size="lg" />
                      </button>
                    ) : (
                      <CardView key={draw27 ? `${handNo}-${c}` : `${handNo}-${k}`} card={c} hidden={!reveal} size={isHero ? 'lg' : 'sm'} delay={draw27 && hand!.street !== 'preflop' ? 0 : k * 120} />
                    ),
                  )}
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
                  {avatarFor(p.name) && !(online && !p.id.startsWith('bot')) ? <img className="avatar" src={avatarFor(p.name)!} alt="" /> : online && !isHero ? <div className="avatar me friend">{p.name.trim().charAt(0).toUpperCase() || '♠'}</div> : <div className="avatar me">♠</div>}
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
                {online?.awayIds.includes(p.id) && !p.out && <div className="last k-away">Absent</div>}
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
          {draw27 ? (
            <div className="draw-stage">
              <span className="draw-dots" aria-hidden="true">
                {[1, 2, 3].map((k) => <i key={k} className={hand && drawsDone(hand.street, isDrawing(hand)) >= k ? 'on' : ''} />)}
              </span>
              <b className="short">{hand ? (isDrawing(hand) ? `Tirage ${Math.ceil(drawsDone(hand.street, true))} sur 3` : hand.street === 'preflop' ? 'Avant le 1er tirage' : hand.street === 'complete' || hand.street === 'showdown' ? 'Main terminée' : `Enchères · ${Math.ceil(drawsDone(hand.street, false))} tirage${hand.street === 'flop' ? '' : 's'} fait${hand.street === 'flop' ? '' : 's'}`) : '2-7'}</b>
              <b className="long">{hand ? (isDrawing(hand) ? `${DRAW_STAGE[hand.street]} : chacun change ses cartes` : hand.street === 'preflop' ? 'Enchères avant le 1er tirage' : hand.street === 'complete' || hand.street === 'showdown' ? 'Main terminée' : `Enchères après le ${DRAW_STAGE[hand.street]}`) : '2-7 Triple Draw'}</b>
              <small>La main la plus basse gagne · 7-5-4-3-2 est la meilleure</small>
            </div>
          ) : (
            <div className="board">
              {[0, 1, 2, 3, 4].map((k) => (hand?.board[k] ? <CardView key={`${handNo}-b${k}`} card={hand.board[k]} size="md" delay={k < 3 ? k * 90 : 0} /> : <div key={k} className="card slot md" />))}
            </div>
          )}
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
        <TourneyEnd place={game.heroPlace} total={game.total} hands={handNo} level={game.levelIndex + 1} eliminated={game.eliminated} onReplay={online ? undefined : onReplay} onQuit={onQuit} />
      )}

      {review && <HandReview record={review} onClose={() => setReview(null)} />}
      {online && <OnlineBanner online={online} />}
      <footer className="actions">
        {done && online ? (
          <OnlineNext online={online} canReview={!!(game.lastRecordId && hand)} onReview={() => setReview(loadHands().find((h) => h.id === game.lastRecordId) ?? null)} onDeal={deal} over={tourney && game.tourneyOver} />
        ) : online?.spectator ? (
          <span className="waiting">Tu prendras place à la prochaine main.</span>
        ) : done ? (
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
        ) : heroDrawing && hero ? (
          <DrawPanel hand={hand!} hole={hero.holeCards} picked={picked} onPick={setPicked} onDraw={(d) => act({ type: 'draw', discard: d })} />
        ) : heroTurn && legal ? (
          <BetPanel hand={hand!} legal={legal} allIn={hero!.stack + hero!.bet} onAct={act} onAmount={setRaiseTo} />
        ) : (
          <span className="waiting">{hand && isDrawing(hand) ? 'Les adversaires changent leurs cartes…' : 'Les adversaires réfléchissent…'}</span>
        )}
      </footer>
    </div>
  );
}

/** Nombre de tirages déjà commencés (2-7). */
function drawsDone(street: string, drawing: boolean): number {
  const base = { preflop: 0, flop: 1, turn: 2, river: 3, showdown: 3, complete: 3 }[street] ?? 0;
  return drawing ? base - 0.5 : base;
}

/** Bandeaux du jeu entre amis : absence du joueur, de l'hôte, problème de connexion. */
function OnlineBanner({ online }: { online: OnlineTableInfo }) {
  if (online.away)
    return (
      <div className="online-banner" role="status">
        Tu n’as pas joué à temps : on joue pour toi (parole ou couché).
        <button className="primary" onClick={online.back}>Je suis là</button>
      </div>
    );
  if (online.hostAway) return <div className="online-banner" role="status">{online.hostName || 'L’hôte'} s’est absenté : la partie reprendra dès son retour.</div>;
  if (online.error) return <div className="online-banner" role="status">{online.error}</div>;
  return null;
}

function OnlineNext({ online, canReview, onReview, onDeal, over }: { online: OnlineTableInfo; canReview: boolean; onReview: () => void; onDeal: () => void; over: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const left = online.nextDealAt ? Math.max(0, Math.ceil((online.nextDealAt - now) / 1000)) : null;
  return (
    <div className="done-actions">
      {canReview && (
        <button className="pill review-btn" onClick={onReview}>
          Analyse de la main
        </button>
      )}
      {over ? (
        <span className="waiting">Partie terminée.</span>
      ) : online.isHost ? (
        <>
          <button className="pill" onClick={() => online.setPaused(!online.paused)} aria-pressed={online.paused}>
            {online.paused ? '▶ Reprendre' : '❚❚ Pause'}
          </button>
          <button className="primary" onClick={onDeal}>
            Main suivante{left !== null && !online.paused ? ` (${left} s)` : ''}
          </button>
        </>
      ) : (
        <span className="waiting">{online.paused ? `${online.hostName || 'L’hôte'} a mis la partie en pause.` : left !== null ? `Main suivante dans ${left} s` : 'Main suivante dans un instant…'}</span>
      )}
    </div>
  );
}
