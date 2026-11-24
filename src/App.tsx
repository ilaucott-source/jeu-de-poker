import { useState } from 'react';
import type { BettingStructure } from './engine/holdem';
import type { CashGameOptions, GameMode } from './game/useCashGame';
import { LEVEL_FR, pickBots, type BotLevel } from './engine/bots';
import { SPEED, type TourneySpeed } from './game/tournament';
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
  const [opts, setOptsRaw] = useState<CashGameOptions>(() => {
    const base: CashGameOptions = { mode: 'cash', structure: 'NL', bigBlind: 2, buyInBB: 100, bots: 5, level: 'moyen', speed: 'normal', timer: 'relaxed' };
    try {
      return { ...base, ...JSON.parse(localStorage.getItem('poker-menu') ?? '{}') };
    } catch {
      return base;
    }
  });
  const setOpts = (o: CashGameOptions) => {
    setOptsRaw(o);
    try {
      localStorage.setItem('poker-menu', JSON.stringify(o));
    } catch {
      /* rien */
    }
  };
  const [game, setGame] = useState(0);
  const [playing, setPlaying] = useState(false);

  if (playing)
    return (
      <Table
        key={game}
        options={opts}
        onQuit={() => setPlaying(false)}
        onReplay={() => setGame((g) => g + 1)}
      />
    );
  const tourney = opts.mode === 'tournament';
  const preview = opts.level === 'mix' ? null : pickBots(opts.level, opts.bots);

  return (
    <div className={`menu-screen ${tourney ? 'tourney' : ''}`}>
      <div className="menu">
        <div className="brand">
          <span className="emblem" aria-hidden="true"><span>♠</span></span>
          <h1>Jeu de Poker</h1>
          <p className="sub">Texas Hold'em</p>
        </div>
        <div className="field">
          <span>Mode</span>
          <Segmented<GameMode>
            label="Mode"
            value={opts.mode}
            onChange={(v) => setOpts({ ...opts, mode: v, timer: v === 'tournament' && opts.timer === 'relaxed' ? 'normal' : v === 'cash' && opts.timer === 'normal' ? 'relaxed' : opts.timer })}
            options={[
              { v: 'cash', label: 'Cash game' },
              { v: 'tournament', label: 'Tournoi' },
            ]}
          />
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
          <span>Niveau des adversaires</span>
          <Segmented<BotLevel | 'mix'>
            label="Niveau"
            value={opts.level}
            onChange={(v) => setOpts({ ...opts, level: v })}
            options={(['facile', 'moyen', 'difficile', 'expert', 'mix'] as const).map((v) => ({ v, label: LEVEL_FR[v] }))}
          />
          <p className="note">{preview ? preview.map((b) => `${b.name} (${b.blurb})`).join(' · ') : 'Adversaires tirés au hasard parmi les neuf personnages.'}</p>
        </div>
        {tourney && (
          <div className="field">
            <span>Vitesse du tournoi</span>
            <Segmented<TourneySpeed>
              label="Vitesse"
              value={opts.speed}
              onChange={(v) => setOpts({ ...opts, speed: v })}
              options={(['normal', 'turbo'] as const).map((v) => ({ v, label: SPEED[v].label }))}
            />
            <p className="note">Chacun commence avec 1 500 jetons. {SPEED[opts.speed].hint} Le dernier joueur en lice gagne.</p>
          </div>
        )}
        <div className="field">
          <label htmlFor="timer">Temps pour jouer</label>
          <select id="timer" value={opts.timer} onChange={(e) => setOpts({ ...opts, timer: e.target.value as TimerPreset })}>
            {(Object.keys(TIMER_PRESETS) as TimerPreset[]).map((k) => <option key={k} value={k}>{TIMER_PRESETS[k].label}</option>)}
          </select>
        </div>
        <p className="note">{TIMER_PRESETS[opts.timer].hint} Ensuite une banque de temps prend le relais.</p>
        <button className="primary big" onClick={() => setPlaying(true)}>Jouer</button>
      </div>
    </div>
  );
}
