import { describe, expect, it } from 'vitest';
import { applyAction, buildPots, legalActions, startHand, type HandConfig, type HandState, type PlayerState } from './holdem';

const seats = (...stacks: number[]) => stacks.map((s, i) => ({ id: `p${i}`, name: `J${i}`, stack: s }));
const cfg = (over: Partial<HandConfig> = {}): HandConfig => ({ structure: 'NL', smallBlind: 1, bigBlind: 2, buttonIndex: 0, seed: 42, ...over });
const total = (s: HandState) => s.players.reduce((a, p) => a + p.stack + p.committed, 0);
const who = (s: HandState) => s.players[s.toAct!].id;

describe('déroulement d\'une main de Hold\'em', () => {
  it('poste les blinds et distribue 2 cartes', () => {
    const s = startHand(seats(100, 100, 100), cfg());
    expect(s.players[1].committed).toBe(1);
    expect(s.players[2].committed).toBe(2);
    expect(s.players.every((p) => p.holeCards.length === 2)).toBe(true);
    expect(who(s)).toBe('p0'); // UTG = le bouton à 3 joueurs
  });

  it('heads-up : le bouton est petite blind et parle en premier préflop, en dernier postflop', () => {
    let s = startHand(seats(100, 100), cfg());
    expect(s.sbIndex).toBe(0);
    expect(who(s)).toBe('p0');
    s = applyAction(s, { type: 'call' });
    expect(who(s)).toBe('p1'); // option de la grosse blind
    s = applyAction(s, { type: 'check' });
    expect(s.street).toBe('flop');
    expect(s.board).toHaveLength(3);
    expect(who(s)).toBe('p1');
  });

  it('tout le monde se couche : la grosse blind gagne', () => {
    let s = startHand(seats(100, 100, 100), cfg());
    s = applyAction(s, { type: 'fold' });
    s = applyAction(s, { type: 'fold' });
    expect(s.street).toBe('complete');
    expect(s.players[2].stack).toBe(101);
    expect(total(s)).toBe(300);
  });

  it('la grosse blind a l\'option de relancer après des limps', () => {
    let s = startHand(seats(100, 100, 100), cfg());
    s = applyAction(s, { type: 'call' });
    s = applyAction(s, { type: 'call' });
    expect(who(s)).toBe('p2');
    const l = legalActions(s)!;
    expect(l.canCheck).toBe(true);
    expect(l.canBetOrRaise).toBe(true);
    expect(l.minTo).toBe(4);
  });

  it('No Limit : la relance minimum suit la dernière relance', () => {
    let s = startHand(seats(500, 500, 500), cfg());
    s = applyAction(s, { type: 'raise', to: 10 }); // relance de 8
    const l = legalActions(s)!;
    expect(l.minTo).toBe(18);
    expect(l.maxTo).toBe(500);
    expect(() => applyAction(s, { type: 'raise', to: 15 })).toThrow();
  });

  it('Pot Limit : la relance maximum vaut le pot', () => {
    let s = startHand(seats(500, 500, 500), cfg({ structure: 'PL' }));
    // pot = 3, pour suivre 2 → pot après call = 5 → relance max à 2 + 5 = 7
    expect(legalActions(s)!.maxTo).toBe(7);
    s = applyAction(s, { type: 'raise', to: 7 });
    // SB : pot = 10, à suivre 6 → pot 16 → max à 7 + 16 = 23
    expect(legalActions(s)!.maxTo).toBe(23);
  });

  it('Limit : montants fixes et plafond de 4 mises', () => {
    let s = startHand(seats(500, 500, 500), cfg({ structure: 'FL' }));
    let l = legalActions(s)!;
    expect(l.minTo).toBe(4);
    expect(l.maxTo).toBe(4);
    s = applyAction(s, { type: 'raise', to: 4 });
    s = applyAction(s, { type: 'raise', to: 6 });
    s = applyAction(s, { type: 'raise', to: 8 }); // 4e mise
    l = legalActions(s)!;
    expect(l.canBetOrRaise).toBe(false);
    s = applyAction(s, { type: 'call' });
    s = applyAction(s, { type: 'call' });
    expect(s.street).toBe('flop');
    expect(legalActions(s)!.minTo).toBe(2);
    s = applyAction(s, { type: 'check' });
    s = applyAction(s, { type: 'check' });
    s = applyAction(s, { type: 'check' });
    expect(s.street).toBe('turn');
    expect(legalActions(s)!.minTo).toBe(4); // grosse mise au turn
  });

  it('tapis et pots secondaires : les jetons sont conservés', () => {
    let s = startHand(seats(20, 50, 100), cfg());
    s = applyAction(s, { type: 'raise', to: 20 }); // p0 tapis
    s = applyAction(s, { type: 'raise', to: 50 }); // p1 tapis
    s = applyAction(s, { type: 'call' }); // p2 suit
    expect(s.street).toBe('complete');
    expect(s.board).toHaveLength(5);
    expect(total(s)).toBe(170);
    expect(s.results!.length).toBeGreaterThanOrEqual(1);
  });

  it('découpe correctement les pots secondaires', () => {
    const mk = (id: string, committed: number, folded = false) => ({ id, committed, folded, out: false }) as PlayerState;
    const pots = buildPots([mk('a', 20), mk('b', 50), mk('c', 100), mk('d', 10, true)]);
    expect(pots).toEqual([
      { amount: 70, eligible: ['a', 'b', 'c'] },
      { amount: 60, eligible: ['b', 'c'] },
      { amount: 50, eligible: ['c'] },
    ]);
  });

  it('une relance incomplète (tapis) ne rouvre pas les enchères', () => {
    let s = startHand(seats(100, 100, 13), cfg({ buttonIndex: 2 }));
    // bouton = p2, SB = p0, BB = p1, UTG = p2
    expect(who(s)).toBe('p2');
    s = applyAction(s, { type: 'raise', to: 10 }); // p2 relance à 10
    s = applyAction(s, { type: 'call' }); // p0 suit
    s = applyAction(s, { type: 'call' }); // p1 suit
    expect(s.street).toBe('flop');
    s = applyAction(s, { type: 'bet', to: 2 }); // p0 mise 2
    s = applyAction(s, { type: 'call' }); // p1 suit
    s = applyAction(s, { type: 'raise', to: 3 }); // p2 tapis à 3 (relance incomplète)
    expect(who(s)).toBe('p0');
    const l = legalActions(s)!;
    expect(l.canBetOrRaise).toBe(false);
    expect(l.callAmount).toBe(1);
  });

  it('les jetons sont toujours conservés sur 500 mains aléatoires', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const n = 2 + (seed % 7);
      const structure = (['NL', 'PL', 'FL'] as const)[seed % 3];
      let s = startHand(seats(...Array.from({ length: n }, (_, i) => 20 + ((seed * (i + 3)) % 200))), cfg({ seed, structure, buttonIndex: seed % n, ante: seed % 4 === 0 ? 1 : 0 }));
      const start = total(s);
      let r = seed;
      let guard = 0;
      while (s.street !== 'complete') {
        if (++guard > 500) throw new Error('boucle infinie');
        const l = legalActions(s)!;
        r = (r * 1103515245 + 12345) % 2147483648;
        const x = r % 10;
        if (x < 2 && l.canFold) s = applyAction(s, { type: 'fold' });
        else if (x < 5 && l.canBetOrRaise) s = applyAction(s, { type: l.isBet ? 'bet' : 'raise', to: l.minTo + ((r >> 4) % (l.maxTo - l.minTo + 1)) });
        else s = applyAction(s, l.canCheck ? { type: 'check' } : { type: 'call' });
      }
      expect(total(s)).toBe(start);
      expect(s.players.every((p) => p.stack >= 0)).toBe(true);
    }
  });
});
