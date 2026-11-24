import { useState } from 'react';
import type { BettingStructure } from './engine/holdem';
import type { CashGameOptions } from './game/useCashGame';
import { Table } from './ui/Table';
import { TIMER_PRESETS, type TimerPreset } from './game/timer';

function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.v)} role="radio" aria-checked={o.v === value} className={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const [opts, setOpts] = useState<CashGameOptions>({ structure: 'NL', bigBlind: 2, buyInBB: 100, bots: 5, timer: 'relaxed' });
  const [playing, setPlaying] = useState(false);

  if (playing) return <Table options={opts} onQuit={() => setPlaying(false)} />;

  return (
    <div className="menu-screen">
      <div className="menu">
        <div className="brand">
          <span className="emblem" aria-hidden="true"><span>♠</span></span>
          <h1>Jeu de Poker</h1>
          <p className="sub">Texas Hold'em · Cash game</p>
        </div>
        <div className="field">
          <span>Variante</span>
          <Segmented<BettingStructure>
            label="Variante"
            value={opts.structure}
            onChange={(v) => setOpts({ ...opts, structure: v })}
            options={[
              { v: 'NL', label: 'No Limit' },
              { v: 'PL', label: 'Pot Limit' },
              { v: 'FL', label: 'Limit' },
            ]}
          />
        </div>
        <div className="field">
          <span>Adversaires</span>
          <Segmented<number> label="Adversaires" value={opts.bots} onChange={(v) => setOpts({ ...opts, bots: v })} options={[1, 2, 3, 4, 5].map((n) => ({ v: n, label: String(n) }))} />
        </div>
        <div className="field">
          <label htmlFor="timer">Temps pour jouer</label>
          <select id="timer" value={opts.timer} onChange={(e) => setOpts({ ...opts, timer: e.target.value as TimerPreset })}>
            {(Object.keys(TIMER_PRESETS) as TimerPreset[]).map((k) => <option key={k} value={k}>{TIMER_PRESETS[k].label}</option>)}
          </select>
        </div>
        <p className="note">{TIMER_PRESETS[opts.timer].hint} Si le temps est écoulé, une banque de temps prend le relais, puis tu passes parole ou tu te couches automatiquement.</p>
        <button className="primary big" onClick={() => setPlaying(true)}>Jouer</button>
      </div>
    </div>
  );
}
