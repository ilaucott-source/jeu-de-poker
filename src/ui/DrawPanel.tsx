import type { Card } from '../engine/cards';
import type { HandState } from '../engine/holdem';
import { drawsLeft } from '../engine/draw27';
import { drawText, planDraw } from '../engine/lowball';

interface Props {
  hand: HandState;
  hole: Card[];
  picked: number[];
  onPick: (p: number[]) => void;
  onDraw: (discard: number[]) => void;
}

/** 2-7 : touche les cartes à changer, puis valide. Un bouton propose le tirage conseillé. */
export function DrawPanel({ hand, hole, picked, onPick, onDraw }: Props) {
  const left = drawsLeft(hand);
  const advice = planDraw(hole, left);
  const same = advice.length === picked.length && advice.every((i) => picked.includes(i));
  return (
    <div className="draw-panel">
      <p className="draw-help">
        Touche les cartes à changer · {left === 1 ? 'dernier tirage' : `encore ${left} tirages`}
      </p>
      <div className="main-actions">
        <button className={`act advice ${same ? 'on' : ''}`} onClick={() => onPick(advice)} title="Sélectionne les cartes conseillées">
          Conseil : {drawText(hole, advice)}
        </button>
        {picked.length === 0 ? (
          <button className="act primary" onClick={() => onDraw([])}>Servi · garder mes 5 cartes</button>
        ) : (
          <button className="act primary" onClick={() => onDraw(picked)}>
            Changer {picked.length} carte{picked.length > 1 ? 's' : ''}
          </button>
        )}
      </div>
    </div>
  );
}
