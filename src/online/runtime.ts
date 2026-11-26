import type { HandScript } from '../engine/analysis';
import type { HandState, PlayerAction } from '../engine/holdem';
import type { CashGameOptions, Elimination } from '../game/useCashGame';
import { HostCore, isBotSeat, remoteDeadline, type HostSave } from './hostCore';
import { HOST_ID, localize, localizeElims, redact, rotateTo, seatIdFor, type MemberDoc, type OnlineSeat, type TableDoc, type TableStatus } from './protocol';
import * as net from './net';

/** Ce que l'écran de jeu affiche, côté hôte comme côté ami. */
export interface OnlineSnapshot {
  code: string;
  isHost: boolean;
  status: TableStatus;
  opts: CashGameOptions;
  /** sièges vus par ce joueur (son siège s'appelle 'hero') */
  seats: OnlineSeat[];
  /** dans le salon : les amis présents */
  lobby: { uid: string; name: string }[];
  handNo: number;
  hand: HandState | null;
  eliminated: Elimination[];
  nextDealAt: number | null;
  paused: boolean;
  /** l'hôte ne donne plus signe de vie */
  hostAway: boolean;
  hostName: string;
  /** ce joueur a un siège à la table */
  seated: boolean;
  /** l'hôte joue pour lui (absent) */
  away: boolean;
  /** main terminée : script pour l'historique et l'analyse (vue de ce joueur) */
  record: { hand: number; script: HandScript } | null;
  error: string | null;
  /** la partie tourne sur un autre appareil de l'hôte */
  takenOver: boolean;
}

export interface OnlineConn {
  readonly isHost: boolean;
  readonly code: string;
  subscribe(cb: () => void): () => void;
  snapshot(): OnlineSnapshot;
  act(a: PlayerAction): void;
  /** hôte : lancer la partie / distribuer tout de suite */
  start(): void;
  deal(): void;
  setPaused(p: boolean): void;
  back(): void;
  close(): void;
}

const NEXT_DEAL_MS = 6000;
const NEXT_DEAL_SHOWDOWN_MS = 8000;
const HEARTBEAT_MS = 20000;
const HOST_AWAY_MS = 50000;

class Emitter {
  private subs = new Set<() => void>();
  subscribe(cb: () => void) {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }
  emit() {
    this.subs.forEach((f) => f());
  }
}

/** L'appareil de l'hôte : fait tourner la partie et la publie. */
export class HostRuntime extends Emitter implements OnlineConn {
  readonly isHost = true;
  core: HostCore | null;
  private table: TableDoc;
  private session = net.newSession();
  private unsubs: (() => void)[] = [];
  private turnKey = '';
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private dealTimer: ReturnType<typeof setTimeout> | null = null;
  private beat: ReturnType<typeof setInterval> | null = null;
  private nextDealAt: number | null = null;
  private paused = false;
  private sentPrivate = new Map<string, string>();
  private lastBack = new Map<string, number>();
  private lastState = 0;
  private closed = false;
  private error: string | null = null;
  private takenOver = false;
  private snap: OnlineSnapshot | null = null;

  readonly code: string;
  constructor(code: string, table: TableDoc, save: HostSave | null) {
    super();
    this.code = code;
    this.table = table;
    this.core = save ? new HostCore(save) : null;
    this.paused = table.paused;
  }

  async open() {
    this.table = { ...this.table, hostSession: this.session };
    await net.writeTable(this.code, { hostSession: this.session, alive: Date.now(), paused: this.paused });
    this.unsubs.push(
      await net.watchTable(this.code, (t) => {
        if (t && t.hostSession !== this.session) {
          this.takenOver = true;
          this.close();
          this.changed();
        }
      }),
    );
    this.unsubs.push(await net.watchMembers(this.code, (m) => this.onMembers(m)));
    this.unsubs.push(await net.watchIntents(this.code, (uid, i) => this.onIntent(uid, i)));
    this.beat = setInterval(() => {
      if (Date.now() - this.table.alive > HEARTBEAT_MS - 1000) this.publish({ alive: Date.now() });
    }, HEARTBEAT_MS);
    this.update();
  }

  private onMembers(m: Record<string, MemberDoc>) {
    const hostUid = this.table.host;
    if (!this.core) {
      // salon : la liste des amis présents
      const seats: OnlineSeat[] = [this.table.seats[0]];
      for (const [uid, d] of Object.entries(m)) if (uid !== hostUid && !d.left && seats.length < this.table.opts.bots + 1) seats.push({ id: seatIdFor(uid), name: d.name, kind: 'human', uid, stack: 0 });
      this.publish({ seats });
      this.changed();
      return;
    }
    let touched = false;
    for (const [uid, d] of Object.entries(m)) {
      if (uid === hostUid) continue;
      const seat = this.core.seatOfUid(uid);
      const waiting = this.core.s.waiting.some((w) => w.uid === uid);
      if (d.left) {
        if (seat || waiting) {
          this.core.leave(uid);
          touched = true;
        }
      } else if (!seat && !waiting) {
        if (this.core.join(uid, d.name) !== 'full') touched = true;
      } else if (seat && seat.name !== d.name) {
        seat.name = d.name;
        touched = true;
      }
    }
    if (touched) this.update();
  }

  private onIntent(uid: string, i: { hand: number; at: number; action: PlayerAction | null; back?: number }) {
    if (!this.core) return;
    const seat = this.core.seatOfUid(uid);
    if (!seat) return;
    let touched = false;
    if (i.back && i.back > (this.lastBack.get(uid) ?? 0)) {
      this.lastBack.set(uid, i.back);
      if (seat.away && !seat.leaving) {
        this.core.setBack(uid);
        touched = true;
      }
    }
    if (i.action && i.hand === this.core.s.handNo && this.core.apply(seat.id, i.action, i.at)) {
      if (!seat.leaving) seat.away = false;
      touched = true;
    }
    if (touched) this.update();
  }

  /** Lancer la partie depuis le salon : les places vides sont données à des bots. */
  start() {
    if (this.core) return;
    const humans = this.table.seats.filter((s) => s.uid).map((s) => ({ uid: s.uid!, name: s.name }));
    this.core = HostCore.create(this.table.opts, humans);
    this.core.deal();
    this.update();
  }

  deal() {
    if (!this.core || this.core.over) return;
    const h = this.core.s.hand;
    if (h && h.street !== 'complete') return;
    this.core.deal();
    this.update();
  }

  act(a: PlayerAction) {
    if (this.core?.apply(HOST_ID, a)) this.update();
  }

  setPaused(p: boolean) {
    this.paused = p;
    this.update();
  }

  back() {}

  /** Après chaque changement : publier, puis programmer la suite (bot, délai d'un ami, main suivante). */
  private update() {
    if (this.closed) return;
    this.schedule();
    this.publishAll();
    this.changed();
  }

  private schedule() {
    const core = this.core;
    if (!core) return;
    const h = core.s.hand;
    // main suivante
    if (h && h.street === 'complete' && !core.over && !this.paused) {
      if (this.nextDealAt === null || this.dealKey !== core.s.handNo) {
        this.dealKey = core.s.handNo;
        this.nextDealAt = Date.now() + (h.showdown ? NEXT_DEAL_SHOWDOWN_MS : NEXT_DEAL_MS);
        if (this.dealTimer) clearTimeout(this.dealTimer);
        this.dealTimer = setTimeout(() => {
          this.nextDealAt = null;
          this.deal();
        }, this.nextDealAt - Date.now());
      }
    } else {
      this.nextDealAt = null;
      if (this.dealTimer) clearTimeout(this.dealTimer);
      this.dealTimer = null;
    }
    // tour de jeu
    const seat = core.current();
    const key = seat ? `${core.s.handNo}-${h!.log.length}-${seat.id}-${seat.away ? 'a' : ''}` : '';
    if (key === this.turnKey) return;
    this.turnKey = key;
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    if (!seat || seat.kind === 'host') return;
    const at = h!.log.length;
    const play = (a: PlayerAction | null, markAway = false) => {
      if (!a || !this.core) return;
      if (this.core.apply(seat.id, a, at)) {
        if (markAway && !isBotSeat(seat)) seat.away = true;
        this.update();
      }
    };
    if (isBotSeat(seat)) {
      const m = core.botMove()!;
      this.turnTimer = setTimeout(() => play(m.action), m.delay);
    } else if (seat.away) this.turnTimer = setTimeout(() => play(this.core!.defaultAction()), 1200);
    else this.turnTimer = setTimeout(() => play(this.core!.defaultAction(), true), remoteDeadline(core.opts));
  }
  private dealKey = -1;

  private pending: Partial<TableDoc> | null = null;
  private writing = false;
  private publish(patch: Partial<TableDoc>) {
    this.table = { ...this.table, ...patch };
    this.pending = { ...(this.pending ?? {}), ...patch };
    void this.flush();
  }
  private async flush() {
    if (this.writing || !this.pending || this.closed) return;
    this.writing = true;
    const p = this.pending;
    this.pending = null;
    try {
      await net.writeTable(this.code, { ...p, ts: Date.now() });
      this.error = null;
    } catch {
      this.error = 'Connexion perdue : la table se remettra à jour au retour du réseau.';
      this.pending = { ...p, ...(this.pending ?? {}) };
      setTimeout(() => void this.flush(), 3000);
    } finally {
      this.writing = false;
    }
    if (this.pending) void this.flush();
  }

  private publishAll() {
    const core = this.core;
    if (!core) return;
    const h = core.s.hand;
    const status: TableStatus = core.over && (!h || h.street === 'complete') ? 'over' : 'playing';
    this.publish({
      status,
      opts: core.opts,
      seats: core.s.seats.map((s) => ({ ...s })),
      handNo: core.s.handNo,
      pub: h ? JSON.stringify(redact(h)) : null,
      eliminated: core.s.eliminated,
      nextDealAt: this.nextDealAt,
      paused: this.paused,
      alive: Date.now(),
    });
    // cartes de chaque ami, et en fin de main de quoi l'analyser
    if (h)
      for (const seat of core.s.seats) {
        if (seat.kind !== 'human' || !seat.uid) continue;
        const p = h.players.find((x) => x.id === seat.id);
        if (!p) continue;
        const done = h.street === 'complete';
        const key = `${core.s.handNo}|${p.holeCards.join('')}|${done}`;
        if (this.sentPrivate.get(seat.uid) === key) continue;
        this.sentPrivate.set(seat.uid, key);
        const script = done ? core.scriptForSeat(seat.id) : null;
        void net.writePrivate(this.code, seat.uid, { hand: core.s.handNo, cards: p.holeCards, record: script ? { hand: core.s.handNo, script: JSON.stringify(script) } : null }).catch(() => this.sentPrivate.delete(seat.uid!));
      }
    // sauvegarde complète (pour reprendre sur cet appareil ou un autre)
    const now = Date.now();
    if (!h || h.street === 'complete' || h.log.length <= (h.config.ante ? h.players.length + 2 : 2) || now - this.lastState > 15000) {
      this.lastState = now;
      void net.writeHostState(this.code, core.s).catch(() => (this.lastState = 0));
    }
  }

  snapshot(): OnlineSnapshot {
    if (this.snap) return this.snap;
    const core = this.core;
    const h = core?.s.hand ?? null;
    // l'hôte non plus ne doit pas voir après coup les cartes couchées de ses amis : même script « brouillé » que pour eux
    const mine = h && h.street === 'complete' ? core!.scriptForSeat(HOST_ID) : null;
    const record = mine ? { hand: core!.s.handNo, script: mine } : null;
    this.snap = {
      code: this.code,
      isHost: true,
      status: core ? (core.over && (!h || h.street === 'complete') ? 'over' : 'playing') : 'lobby',
      opts: core?.opts ?? this.table.opts,
      seats: core ? core.s.seats : this.table.seats,
      lobby: this.table.seats.filter((s) => s.uid).map((s) => ({ uid: s.uid!, name: s.name })),
      handNo: core?.s.handNo ?? 0,
      hand: h ? rotateTo(redact(h, HOST_ID), HOST_ID) : null,
      eliminated: core?.s.eliminated ?? [],
      nextDealAt: this.nextDealAt,
      paused: this.paused,
      hostAway: false,
      hostName: this.table.hostName,
      seated: true,
      away: false,
      record,
      error: this.error,
      takenOver: this.takenOver,
    };
    return this.snap;
  }

  private changed() {
    this.snap = null;
    this.emit();
  }

  /** L'hôte quitte l'écran : la partie se met en pause pour tous (il pourra la reprendre). */
  close() {
    if (this.closed) return;
    if (this.core && !this.takenOver) void net.writeHostState(this.code, this.core.s).catch(() => undefined);
    this.closed = true;
    this.unsubs.forEach((u) => u());
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.dealTimer) clearTimeout(this.dealTimer);
    if (this.beat) clearInterval(this.beat);
  }

  /** Hôte : mettre fin à la table pour tout le monde. */
  async end() {
    this.close();
    await net.writeTable(this.code, { status: 'over', ts: Date.now() }).catch(() => undefined);
  }
}

/** L'appareil d'un ami : reçoit la table publique et ses propres cartes, envoie ses actions. */
export class GuestRuntime extends Emitter implements OnlineConn {
  readonly isHost = false;
  private table: TableDoc | null = null;
  private priv: { hand: number; cards: string[]; record?: { hand: number; script: string } | null } | null = null;
  private unsubs: (() => void)[] = [];
  private pendingAt: string | null = null;
  private error: string | null = null;
  private snap: OnlineSnapshot | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  readonly code: string;
  readonly uid: string;
  constructor(code: string, uid: string) {
    super();
    this.code = code;
    this.uid = uid;
  }

  get myId() {
    return seatIdFor(this.uid);
  }

  async open() {
    this.unsubs.push(
      await net.watchTable(
        this.code,
        (t) => {
          this.table = t;
          this.error = t ? null : 'Cette table n’existe plus.';
          this.changed();
        },
        (m) => {
          this.error = m;
          this.changed();
        },
      ),
    );
    this.unsubs.push(
      await net.watchPrivate(this.code, this.uid, (p) => {
        this.priv = p as typeof this.priv;
        this.changed();
      }),
    );
    // pour savoir si l'hôte est toujours là
    this.tick = setInterval(() => this.changed(), 10000);
  }

  snapshot(): OnlineSnapshot {
    if (this.snap) return this.snap;
    const t = this.table;
    const me = this.myId;
    let hand: HandState | null = null;
    if (t?.pub) {
      const pub = JSON.parse(t.pub) as HandState;
      hand = rotateTo(localize(pub, me, this.priv && this.priv.hand === t.handNo ? (this.priv.cards as HandState['board']) : null), HOST_ID);
      // action envoyée, en attente de l'hôte : on n'affiche plus les boutons
      if (this.pendingAt === `${t.handNo}-${pub.log.length}`) hand = { ...hand, toAct: null };
    }
    const mySeat = t?.seats.find((s) => s.uid === this.uid);
    const m = (id: string) => (id === me ? HOST_ID : id === HOST_ID ? 'host' : id);
    const rec = this.priv?.record;
    this.snap = {
      code: this.code,
      isHost: false,
      status: t?.status ?? 'lobby',
      opts: t?.opts ?? ({} as CashGameOptions),
      seats: (t?.seats ?? []).map((s) => ({ ...s, id: m(s.id) })),
      lobby: (t?.seats ?? []).filter((s) => s.uid).map((s) => ({ uid: s.uid!, name: s.name })),
      handNo: t?.handNo ?? 0,
      hand,
      eliminated: localizeElims(t?.eliminated ?? [], me),
      nextDealAt: t?.nextDealAt ?? null,
      paused: !!t?.paused,
      hostAway: !!t && t.status !== 'over' && Date.now() - t.alive > HOST_AWAY_MS,
      hostName: t?.hostName ?? '',
      seated: !!mySeat,
      away: !!mySeat?.away,
      record: rec && t && rec.hand === t.handNo ? { hand: rec.hand, script: JSON.parse(rec.script) as HandScript } : null,
      error: this.error,
      takenOver: false,
    };
    return this.snap;
  }

  act(a: PlayerAction) {
    const t = this.table;
    if (!t?.pub) return;
    const at = (JSON.parse(t.pub) as HandState).log.length;
    this.pendingAt = `${t.handNo}-${at}`;
    this.changed();
    net.sendIntent(this.code, { hand: t.handNo, at, action: a, ts: Date.now() }).catch(() => {
      this.pendingAt = null;
      this.error = 'Action non envoyée : vérifie ta connexion.';
      this.changed();
    });
  }

  back() {
    const t = this.table;
    void net.sendIntent(this.code, { hand: t?.handNo ?? 0, at: -1, action: null, back: Date.now(), ts: Date.now() }).catch(() => undefined);
  }

  start() {}
  deal() {}
  setPaused() {}

  private changed() {
    if (this.closed) return;
    this.snap = null;
    this.emit();
  }

  close() {
    this.closed = true;
    this.unsubs.forEach((u) => u());
    if (this.tick) clearInterval(this.tick);
  }
}

/** Ouvre une table en tant qu'hôte (nouvelle ou à reprendre). */
export async function openAsHost(code: string): Promise<HostRuntime> {
  const t = await net.getTable(code);
  if (!t) throw new net.OnlineError('Cette table n’existe plus.');
  const save = t.status === 'lobby' ? null : await net.readHostState(code);
  if (t.status !== 'lobby' && !save) throw new net.OnlineError('Impossible de retrouver la partie de cette table.');
  const rt = new HostRuntime(code, t, save);
  await rt.open();
  return rt;
}

export async function openAsGuest(code: string): Promise<GuestRuntime> {
  const rt = new GuestRuntime(code, net.requireUid());
  await rt.open();
  return rt;
}
