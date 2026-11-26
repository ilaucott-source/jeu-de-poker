import { describe, expect, it } from 'vitest';
import { createRng } from '../engine/cards';
import { legalActions, isDrawing, type HandState, type PlayerAction } from '../engine/holdem';
import { analyzeHand, replay } from '../engine/analysis';
import { recordFromHand } from '../game/history';
import type { CashGameOptions } from '../game/useCashGame';
import { HostCore, isBotSeat } from './hostCore';
import { HOST_ALIAS, HOST_ID, isHidden, localize, redact, rotateTo, seatIdFor } from './protocol';

const base: CashGameOptions = { mode: 'cash', structure: 'NL', bigBlind: 2, buyInBB: 100, bots: 5, level: 'moyen', speed: 'normal', pace: 'rapide', timer: 'normal' };

function randomAction(h: HandState, rng: () => number): PlayerAction {
  if (isDrawing(h)) return { type: 'draw', discard: [0, 1, 2, 3, 4].filter(() => rng() < 0.4) };
  const l = legalActions(h)!;
  const r = rng();
  if (l.canBetOrRaise && r < 0.25) return { type: l.isBet ? 'bet' : 'raise', to: l.minTo };
  if (r < 0.75) return l.canCheck ? { type: 'check' } : { type: 'call' };
  return l.canCheck ? { type: 'check' } : { type: 'fold' };
}

/** Joue une main complète : bots avec leur logique, humains au hasard. */
function playHand(core: HostCore, rng: () => number, onState?: (h: HandState) => void) {
  core.deal(Math.floor(rng() * 2 ** 31));
  let guard = 0;
  while (core.s.hand && core.s.hand.street !== 'complete' && guard++ < 400) {
    onState?.(core.s.hand);
    const seat = core.current()!;
    const action = isBotSeat(seat) ? core.botMove()!.action : randomAction(core.s.hand, rng);
    expect(core.apply(seat.id, action, core.s.hand.log.length)).toBe(true);
  }
  onState?.(core.s.hand!);
}

describe('jeu entre amis', { timeout: 30000 }, () => {
  it('place les amis et complète avec des bots', () => {
    const core = HostCore.create(base, [
      { uid: 'A', name: 'Laurent' },
      { uid: 'B', name: 'Paul' },
    ], createRng(3));
    expect(core.s.seats).toHaveLength(6);
    expect(core.s.seats.filter(isBotSeat)).toHaveLength(4);
    expect(core.s.seats.find((s) => s.uid === 'A')!.id).toBe(HOST_ID);
    expect(core.s.seats.find((s) => s.uid === 'B')!.id).toBe(seatIdFor('B'));
  });

  it('ne publie jamais les cartes cachées, ni le paquet, ni la graine', () => {
    for (const variant of ['holdem', 'omaha', 'draw27'] as const) {
      const rng = createRng(11);
      const core = HostCore.create({ ...base, variant, structure: variant === 'draw27' ? 'FL' : 'NL' }, [
        { uid: 'A', name: 'Laurent' },
        { uid: 'B', name: 'Paul' },
      ], rng);
      for (let n = 0; n < 15; n++)
        playHand(core, rng, (h) => {
          const pub = redact(h);
          expect(pub.deck).toEqual([]);
          expect(pub.config.seed).toBe(0);
          for (const p of pub.players) {
            const real = h.players.find((x) => x.id === p.id)!;
            const shown = !!h.showdown?.[p.id];
            if (!shown) expect(p.holeCards.every(isHidden)).toBe(true);
            else expect(p.holeCards).toEqual(real.holeCards);
          }
          const json = JSON.stringify(pub);
          for (const p of h.players) if (!h.showdown?.[p.id]) for (const c of p.holeCards) expect(json.includes(`"${c}"`) && !h.board.includes(c)).toBe(false);
          // vue d'un ami : ses cartes à lui, sous le nom 'hero'
          const mine = h.players.find((x) => x.id === seatIdFor('B'))!.holeCards;
          const view = localize(pub, seatIdFor('B'), mine);
          expect(view.players.find((x) => x.id === HOST_ID)!.holeCards).toEqual(mine);
          expect(view.players.some((x) => x.id === HOST_ALIAS)).toBe(true);
          // table tournée : le joueur en bas, mêmes possibilités de jeu
          const rot = rotateTo(view, HOST_ID);
          expect(rot.players[0].id).toBe(HOST_ID);
          expect(legalActions(rot)).toEqual(legalActions(view));
          if (rot.toAct !== null) expect(rot.players[rot.toAct].id).toBe(view.players[view.toAct!].id);
          expect(rot.players[rot.config.buttonIndex].id).toBe(view.players[view.config.buttonIndex].id);
        });
    }
  });

  it("rejoue la main d'un ami à l'identique pour son analyse, sans révéler les mains couchées", () => {
    for (const variant of ['holdem', 'omaha', 'draw27'] as const) {
      const rng = createRng(29);
      const core = HostCore.create({ ...base, variant, structure: variant === 'draw27' ? 'FL' : 'NL' }, [
        { uid: 'A', name: 'Laurent' },
        { uid: 'B', name: 'Paul' },
      ], rng);
      let checked = 0;
      for (let n = 0; n < 20; n++) {
        playHand(core, rng);
        const id = seatIdFor('B');
        const final = core.s.hand!;
        const script = core.scriptForSeat(id);
        if (!script) continue;
        const states = replay(script);
        const re = states[states.length - 1];
        const view = localize(redact(final), id, final.players.find((p) => p.id === id)!.holeCards);
        const me = re.players.find((p) => p.id === HOST_ID)!;
        expect(me.holeCards).toEqual(view.players.find((p) => p.id === HOST_ID)!.holeCards);
        expect(re.board).toEqual(final.board);
        expect(re.results).toEqual(view.results);
        expect(re.players.map((p) => p.stack)).toEqual(final.players.map((p) => p.stack));
        const rec = recordFromHand(view, script, HOST_ID, 'cash');
        if (rec) {
          expect(() => analyzeHand(rec.script, HOST_ID, 60)).not.toThrow();
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(5);
    }
  });

  it('tournoi : éliminations, puis fin quand il ne reste plus d’ami en jeu ou un seul joueur', () => {
    const rng = createRng(5);
    const core = HostCore.create({ ...base, mode: 'tournament', bots: 3 }, [
      { uid: 'A', name: 'Laurent' },
      { uid: 'B', name: 'Paul' },
    ], rng);
    let n = 0;
    while (!core.over && n++ < 600) playHand(core, rng);
    expect(core.over).toBe(true);
    const places = core.s.eliminated.map((e) => e.place).sort((a, b) => a - b);
    expect(new Set(places).size).toBe(places.length);
  });

  it('cash game : un ami arrive à la place d’un bot, un ami qui part est remplacé par un bot', () => {
    const rng = createRng(8);
    const core = HostCore.create(base, [{ uid: 'A', name: 'Laurent' }], rng);
    playHand(core, rng);
    expect(core.join('C', 'Julie')).toBe('seated');
    expect(core.s.seats.filter((s) => s.kind === 'human')).toHaveLength(1);
    playHand(core, rng);
    core.leave('C');
    expect(core.s.seats.some((s) => s.uid === 'C')).toBe(false);
    expect(core.s.seats.filter(isBotSeat)).toHaveLength(5);
    expect(new Set(core.s.seats.map((s) => s.id)).size).toBe(6);
  });
});
