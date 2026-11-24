import { describe, expect, it } from 'vitest';
import type { Card } from './cards';
import { evaluateBest, HandCategory } from './evaluator';

const h = (s: string) => s.split(' ') as Card[];
const cat = (s: string) => evaluateBest(h(s)).category;
const score = (s: string) => evaluateBest(h(s)).score;

describe('évaluation des mains', () => {
  it('reconnaît chaque catégorie', () => {
    expect(cat('As Ks Qs Js Ts 2c 3d')).toBe(HandCategory.StraightFlush);
    expect(cat('9h 9d 9s 9c Kd 2c 3d')).toBe(HandCategory.Quads);
    expect(cat('9h 9d 9s Kc Kd 2c 3d')).toBe(HandCategory.FullHouse);
    expect(cat('2h 7h 9h Jh Kh 2c 3d')).toBe(HandCategory.Flush);
    expect(cat('5c 6d 7h 8s 9c Kd 2c')).toBe(HandCategory.Straight);
    expect(cat('Ah 2d 3c 4s 5h Kd 9c')).toBe(HandCategory.Straight);
    expect(cat('7h 7d 7s Kc 2d 4c 9d')).toBe(HandCategory.Trips);
    expect(cat('7h 7d Ks Kc 2d 4c 9d')).toBe(HandCategory.TwoPair);
    expect(cat('7h 7d Ks Qc 2d 4c 9d')).toBe(HandCategory.Pair);
    expect(cat('7h 3d Ks Qc 2d 4c 9d')).toBe(HandCategory.HighCard);
  });
  it('la roue est la plus petite quinte', () => {
    expect(score('Ah 2d 3c 4s 5h Kd Kc')).toBeLessThan(score('2h 3d 4c 5s 6h Kd Kc'));
  });
  it('départage au kicker', () => {
    expect(score('Ah Ad Kc 7s 4h 3d 2c')).toBeGreaterThan(score('Ah Ad Qc 7s 4h 3d 2c'));
  });
  it('deux mains identiques sur le board font égalité', () => {
    expect(score('2c 3d As Ks Qs Js Ts')).toBe(score('4c 5d As Ks Qs Js Ts'));
  });
  it('double paire : la 3e paire du board ne compte pas, seul le kicker', () => {
    expect(score('Ah 2c Kd Kc Qd Qc 3s')).toBeGreaterThan(score('Jh 2d Kd Kc Qd Qc 3s'));
  });
  it('full : choisit le meilleur brelan', () => {
    const v = evaluateBest(h('9h 9d 9s Kc Kd Kh 2d'));
    expect(v.category).toBe(HandCategory.FullHouse);
    expect(v.score).toBeGreaterThan(score('9h 9d 9s Qc Qd Qh 2d'));
  });
});
