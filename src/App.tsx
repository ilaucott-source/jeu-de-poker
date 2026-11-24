import { useState } from 'react';
import type { BettingStructure } from './engine/holdem';
import type { CashGameOptions } from './game/useCashGame';
import { Table } from './ui/Table';

export default function App() {
  const [opts, setOpts] = useState<CashGameOptions>({ structure: 'NL', bigBlind: 2, buyInBB: 100, bots: 5 });
  const [playing, setPlaying] = useState(false);

  if (playing) return <Table options={opts} onQuit={() => setPlaying(false)} />;

  return (
    <div className="menu">
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
      <button className="primary big" onClick={() => setPlaying(true)}>Jouer</button>
      <p className="note">Version de travail : moteur de règles complet, bots simples. Le style définitif arrive à l'étape 4.</p>
    </div>
  );
}
