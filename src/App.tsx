import { useState } from 'react';
import type { BettingStructure } from './engine/holdem';
import type { CashGameOptions } from './game/useCashGame';
import { Table } from './ui/Table';
import { TIMER_PRESETS, type TimerPreset } from './game/timer';

export default function App() {
  const [opts, setOpts] = useState<CashGameOptions>({ structure: 'NL', bigBlind: 2, buyInBB: 100, bots: 5, timer: 'relaxed' });
  const [playing, setPlaying] = useState(false);

  if (playing) return <Table options={opts} onQuit={() => setPlaying(false)} />;

  return (
    <div className="menu-screen"><div className="menu">
      <h1>♠ Jeu de Poker</h1>
      <p className="sub">Texas Hold'em · Cash game</p>
      <label>
        Variante
        <select value={opts.structure} onChange={(e) => setOpts({ ...opts, structure: e.target.value as BettingStructure })}>
          <option value="NL">No Limit</option>
          <option value="PL">Pot Limit</option>
          <option value="FL">Limit</option>
        </select>
      </label>
      <label>
        Adversaires
        <select value={opts.bots} onChange={(e) => setOpts({ ...opts, bots: Number(e.target.value) })}>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label>
        Temps pour jouer
        <select id="timer" value={opts.timer} onChange={(e) => setOpts({ ...opts, timer: e.target.value as TimerPreset })}>
          {(Object.keys(TIMER_PRESETS) as TimerPreset[]).map((k) => <option key={k} value={k}>{TIMER_PRESETS[k].label}</option>)}
        </select>
      </label>
      <p className="note">{TIMER_PRESETS[opts.timer].hint} Si le temps est écoulé, une banque de temps prend le relais, puis tu passes parole ou tu te couches automatiquement.</p>
      <button className="primary big" onClick={() => setPlaying(true)}>Jouer</button>
      <p className="note">Version de travail : moteur de règles complet, bots simples. Le style définitif arrive à l'étape 4.</p>
    </div></div>
  );
}
