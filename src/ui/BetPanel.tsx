import { useEffect, useState } from 'react';
import type { HandState, LegalActions, PlayerAction } from '../engine/holdem';
import { amountToSlider, betPresets, sliderToAmount } from '../game/betSizing';

interface Props {
  hand: HandState;
  legal: LegalActions;
  allIn: number;
  onAct: (a: PlayerAction) => void;
}

export function BetPanel({ hand, legal, allIn, onAct }: Props) {
  const [amount, setAmount] = useState(legal.minTo);
  const key = `${hand.log.length}-${legal.minTo}-${legal.maxTo}`;
  useEffect(() => setAmount(legal.minTo), [key, legal.minTo]);

  const presets = betPresets(hand, legal);
  const step = hand.config.bigBlind;
  const v = Math.min(Math.max(amount, legal.minTo), legal.maxTo);
  const ranged = legal.canBetOrRaise && legal.maxTo > legal.minTo;
  const bump = (d: number) => setAmount(Math.min(legal.maxTo, Math.max(legal.minTo, Math.round((v + d) / step) * step || v + d)));

  return (
    <div className="bet-panel">
      {ranged && (
        <div className="sizing">
          {presets.length > 0 && (
            <div className="presets">
              {presets.map((p) => (
                <button key={p.label} className={`chip ${p.to === v ? 'on' : ''}`} onClick={() => setAmount(p.to)}>
                  {p.label}
                </button>
              ))}
            </div>
          )}
          <div className="slider-row">
            <button className="step" aria-label="Diminuer la mise" onClick={() => bump(-step)}>−</button>
            <input
              id="bet-slider"
              type="range"
              min={0}
              max={1000}
              value={Math.round(amountToSlider(v, legal) * 1000)}
              onChange={(e) => setAmount(sliderToAmount(Number(e.target.value) / 1000, legal))}
              aria-label="Montant de la mise"
            />
            <button className="step" aria-label="Augmenter la mise" onClick={() => bump(step)}>+</button>
          </div>
        </div>
      )}
      <div className="main-actions">
        {legal.canFold && <button className="act fold" onClick={() => onAct({ type: 'fold' })}>Se coucher</button>}
        {legal.canCheck ? (
          <button className="act" onClick={() => onAct({ type: 'check' })}>Parole</button>
        ) : (
          <button className="act" onClick={() => onAct({ type: 'call' })}>Suivre {legal.callAmount}</button>
        )}
        {legal.canBetOrRaise && (
          <button className="act primary" onClick={() => onAct({ type: legal.isBet ? 'bet' : 'raise', to: v })}>
            {legal.isBet ? 'Miser' : 'Relancer à'} {v}
            {v === allIn ? ' · tapis' : ''}
          </button>
        )}
      </div>
    </div>
  );
}
