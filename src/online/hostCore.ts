import { BOT_STYLES, pickBots, styledBot, styleFor, type BotStyle } from '../engine/bots';
import { applyAction, isDrawing, legalActions, startHand, stacksAfter, type HandConfig, type HandState, type PlayerAction } from '../engine/holdem';
import { replay, scriptActions, type HandScript } from '../engine/analysis';
import { planDraw } from '../engine/lowball';
import { drawsLeft } from '../engine/draw27';
import { thinkTime } from '../engine/thinking';
import { BLIND_LEVELS, levelFor, payouts, TOURNEY_STACK } from '../game/tournament';
import type { CashGameOptions, Elimination } from '../game/useCashGame';
import { TIMER_PRESETS } from '../game/timer';
import { HOST_ID, scriptFor, seatIdFor, type OnlineSeat } from './protocol';

/** Tout ce qu'il faut pour reprendre la partie sur l'appareil de l'hôte. */
export interface HostSave {
  v: 1;
  opts: CashGameOptions;
  seats: OnlineSeat[];
  button: number;
  handNo: number;
  hand: HandState | null;
  script: Omit<HandScript, 'actions'> | null;
  eliminated: Elimination[];
  /** joueurs arrivés en cours de partie (cash game), placés à la main suivante */
  waiting: { uid: string; name: string }[];
}

export const isBotSeat = (s: { kind: string }) => s.kind === 'bot';

/** Temps maximum que l'hôte laisse à un joueur distant avant de jouer pour lui. */
export function remoteDeadline(opts: CashGameOptions): number {
  const t = TIMER_PRESETS[opts.timer];
  return t.decision === null ? 180_000 : (t.decision + t.bank + 12) * 1000;
}

/**
 * Le moteur de l'hôte, sans réseau ni minuterie : il distribue, applique les actions,
 * fait décider les bots, gère éliminations, recaves et arrivées.
 */
export class HostCore {
  s: HostSave;
  constructor(save: HostSave) {
    this.s = save;
  }

  get opts() {
    return this.s.opts;
  }
  get tourney() {
    return this.s.opts.mode === 'tournament';
  }
  get startStack() {
    return this.tourney ? TOURNEY_STACK : this.s.opts.buyInBB * this.s.opts.bigBlind;
  }

  /** Nouvelle table : les humains (l'hôte d'abord), les places vides prises par des bots, placés au hasard. */
  static create(opts: CashGameOptions, humans: { uid: string; name: string }[], rng: () => number = Math.random): HostCore {
    const total = Math.max(2, opts.bots + 1, humans.length);
    const stack = opts.mode === 'tournament' ? TOURNEY_STACK : opts.buyInBB * opts.bigBlind;
    const seats: OnlineSeat[] = humans.map((h, i) => ({ id: i === 0 ? HOST_ID : seatIdFor(h.uid), name: h.name, kind: i === 0 ? 'host' : 'human', uid: h.uid, stack }));
    const bots = pickBots(opts.level, total - humans.length, Math.floor(rng() * 1e9));
    bots.forEach((b, i) => seats.push({ id: `bot${i}`, name: b.name, kind: 'bot', style: b.name, stack }));
    for (let i = seats.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [seats[i], seats[j]] = [seats[j], seats[i]];
    }
    return new HostCore({ v: 1, opts: { ...opts, bots: total - 1 }, seats, button: Math.floor(rng() * total), handNo: 0, hand: null, script: null, eliminated: [], waiting: [] });
  }

  get total() {
    return this.s.seats.length;
  }
  get alive() {
    return this.total - this.s.eliminated.length;
  }
  get over() {
    return this.tourney && (this.alive <= 1 || !this.s.seats.some((x) => !isBotSeat(x) && !this.s.eliminated.some((e) => e.id === x.id)));
  }

  seatOfUid(uid: string) {
    return this.s.seats.find((x) => x.uid === uid);
  }

  /** Un ami arrive : en tournoi seulement avant le début ; en cash game, il prendra la place d'un bot. */
  join(uid: string, name: string): 'seated' | 'waiting' | 'full' {
    const seat = this.seatOfUid(uid);
    if (seat) {
      seat.name = name || seat.name;
      return 'seated';
    }
    if (this.tourney && this.s.handNo > 0) return 'full';
    if (!this.s.seats.some(isBotSeat)) return 'full';
    if (!this.s.waiting.some((w) => w.uid === uid)) this.s.waiting.push({ uid, name });
    if (this.s.handNo === 0 || !this.s.hand || this.s.hand.street === 'complete') this.seatWaiting();
    return this.seatOfUid(uid) ? 'seated' : 'waiting';
  }

  /** Un ami quitte la table : un bot reprend sa place et ses jetons. */
  leave(uid: string) {
    this.s.waiting = this.s.waiting.filter((w) => w.uid !== uid);
    const seat = this.seatOfUid(uid);
    if (!seat || seat.kind === 'host') return;
    const used = new Set(this.s.seats.map((x) => x.style ?? x.name));
    const style = BOT_STYLES.find((b) => !used.has(b.name)) ?? BOT_STYLES[0];
    const inHand = this.s.hand && this.s.hand.street !== 'complete' && this.s.hand.players.some((p) => p.id === seat.id && !p.out && !p.folded);
    if (inHand) {
      // il finit la main « absent » (parole ou couché), le bot s'assoit à la main suivante
      seat.away = true;
      seat.leaving = true;
      return;
    }
    this.toBot(seat, style);
  }

  private toBot(seat: OnlineSeat, style: BotStyle) {
    const oldId = seat.id;
    let k = 0;
    while (this.s.seats.some((x) => x.id === `bot${k}`) || this.s.eliminated.some((e) => e.id === `bot${k}`)) k++;
    const id = `bot${k}`;
    Object.assign(seat, { id, name: style.name, kind: 'bot', style: style.name, uid: undefined, away: undefined, leaving: undefined });
    this.s.eliminated = this.s.eliminated.map((e) => (e.id === oldId ? { ...e, id } : e));
  }

  /** Les joueurs en attente remplacent des bots (entre deux mains). */
  private seatWaiting() {
    while (this.s.waiting.length) {
      const bot = this.s.seats.find((x) => isBotSeat(x) && !this.s.eliminated.some((e) => e.id === x.id));
      if (!bot) break;
      const w = this.s.waiting.shift()!;
      Object.assign(bot, { id: seatIdFor(w.uid), name: w.name, kind: 'human', uid: w.uid, style: undefined, stack: this.startStack });
    }
  }

  setBack(uid: string) {
    const seat = this.seatOfUid(uid);
    if (seat) seat.away = false;
  }

  /** Distribue la main suivante. */
  deal(seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0): HandState | null {
    if (this.over) return null;
    const { opts } = this;
    // fin de main précédente : départs et arrivées
    for (const seat of this.s.seats)
      if (seat.leaving) {
        const used = new Set(this.s.seats.map((x) => x.style ?? x.name));
        this.toBot(seat, BOT_STYLES.find((b) => !used.has(b.name)) ?? BOT_STYLES[0]);
      }
    if (!this.tourney) {
      this.seatWaiting();
      // en cash game, chacun se recave automatiquement : les bots sous 10 BB, les amis à 0
      for (const seat of this.s.seats) {
        if (isBotSeat(seat) ? seat.stack < opts.bigBlind * 10 : seat.stack <= 0) seat.stack = this.startStack;
      }
    }
    const n = this.s.seats.length;
    let b = this.s.button;
    for (let k = 0; k < n; k++) {
      b = (b + 1) % n;
      if (this.s.seats[b].stack > 0) break;
    }
    this.s.button = b;
    const no = this.s.handNo + 1;
    const lv = this.tourney ? BLIND_LEVELS[levelFor(no, opts.speed)] : { sb: opts.bigBlind / 2, bb: opts.bigBlind, ante: 0 };
    const config: HandConfig = {
      variant: opts.variant && opts.variant !== 'holdem' ? opts.variant : undefined,
      structure: opts.structure,
      smallBlind: lv.sb,
      bigBlind: lv.bb,
      ante: lv.ante || undefined,
      buttonIndex: b,
      seed,
      tourney: this.tourney ? { payouts: payouts(n) } : undefined,
    };
    const seats = this.s.seats.map((x) => ({ id: x.id, name: x.name, stack: x.stack }));
    if (seats.filter((x) => x.stack > 0).length < 2) return null;
    this.s.handNo = no;
    this.s.script = { seats, config };
    this.s.hand = startHand(seats, config);
    return this.s.hand;
  }

  /** Joueur dont c'est le tour, ou null. */
  current(): OnlineSeat | null {
    const h = this.s.hand;
    if (!h || h.toAct === null) return null;
    const id = h.players[h.toAct].id;
    return this.s.seats.find((x) => x.id === id) ?? null;
  }

  /** Applique l'action d'un joueur si c'est bien son tour (et au bon moment). Renvoie true si elle a été jouée. */
  apply(seatId: string, action: PlayerAction, at?: number): boolean {
    const h = this.s.hand;
    if (!h || h.toAct === null || h.players[h.toAct].id !== seatId) return false;
    if (at !== undefined && at !== h.log.length) return false;
    try {
      this.s.hand = applyAction(h, action);
    } catch {
      return false;
    }
    if (this.s.hand.street === 'complete') this.finishHand();
    return true;
  }

  /** Action par défaut quand un joueur n'a pas joué à temps (ou est absent). */
  defaultAction(): PlayerAction | null {
    const h = this.s.hand;
    if (!h || h.toAct === null) return null;
    if (isDrawing(h)) return { type: 'draw', discard: planDraw(h.players[h.toAct].holeCards, drawsLeft(h)) };
    const l = legalActions(h);
    return l ? (l.canCheck ? { type: 'check' } : { type: 'fold' }) : null;
  }

  /** Décision du bot dont c'est le tour, avec son temps de réflexion. */
  botMove(): { action: PlayerAction; delay: number } | null {
    const seat = this.current();
    if (!seat || !isBotSeat(seat)) return null;
    const style = styleFor(seat.style ?? seat.name) ?? BOT_STYLES[0];
    const action = styledBot(this.s.hand!, style);
    return { action, delay: thinkTime(this.s.hand!, style, action, this.opts.pace ?? 'normal') };
  }

  /** Fin de main : tapis, éliminations (le plus gros tapis au début de la main finit devant). */
  private finishHand() {
    const h = this.s.hand!;
    const before = new Map((this.s.script?.seats ?? []).map((p) => [p.id, p.stack]));
    const after = new Map(stacksAfter(h).map((x) => [x.id, x.stack]));
    for (const seat of this.s.seats) if (after.has(seat.id)) seat.stack = after.get(seat.id)!;
    if (!this.tourney) return;
    const busted = h.players.filter((p) => !p.out && (after.get(p.id) ?? 0) <= 0 && !this.s.eliminated.some((e) => e.id === p.id));
    if (!busted.length) return;
    const remaining = this.total - this.s.eliminated.length;
    const sorted = [...busted].sort((a, b) => before.get(a.id)! - before.get(b.id)!);
    this.s.eliminated = [...this.s.eliminated, ...sorted.map((p, k) => ({ id: p.id, name: p.name, place: remaining - k }))];
  }

  /** Script de la main terminée, préparé pour un joueur (cartes jamais vues remélangées). */
  scriptForSeat(seatId: string): HandScript | null {
    const h = this.s.hand;
    if (!h || h.street !== 'complete' || !this.s.script) return null;
    const full: HandScript = { ...this.s.script, actions: scriptActions(h) };
    return scriptFor(full, replay(full), seatId);
  }
}
