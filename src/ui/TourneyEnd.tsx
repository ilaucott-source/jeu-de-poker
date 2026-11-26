import { useState } from 'react';
import type { Elimination } from '../game/useCashGame';
import { ordinalFR, payouts } from '../game/tournament';

interface Props {
  place: number;
  total: number;
  hands: number;
  level: number;
  eliminated: Elimination[];
  onReplay?: () => void;
  onQuit: () => void;
}

/** Écran de fin de tournoi : trophée, médaille ou simple classement. */
export function TourneyEnd({ place, total, hands, level, eliminated, onReplay, onQuit }: Props) {
  const [hidden, setHidden] = useState(false);
  const pay = payouts(total);
  const share = pay[place - 1];
  const img = place === 1 ? './img/trophy.webp' : place === 2 ? './img/medals-silver-bronze.webp' : place === 3 ? './img/medals-silver-bronze.webp' : null;
  const ranking = [...(place === 1 ? [{ id: 'hero', name: 'Toi', place: 1 }] : []), ...eliminated].sort((a, b) => a.place - b.place);
  if (hidden) return <button className="pill end-reopen" onClick={() => setHidden(false)}>Voir le résultat</button>;
  return (
    <div className="end-overlay" role="dialog" aria-label="Fin du tournoi">
      <div className={`end-card ${place === 1 ? 'win' : ''}`}>
        {img ? <img className={`end-img ${place === 1 ? 'trophy' : 'medal'}`} src={img} alt="" /> : <div className="end-rank">{ordinalFR(place)}</div>}
        <h2>{place === 1 ? 'Victoire !' : `Tu termines ${ordinalFR(place)}`}</h2>
        <p className="end-sub">
          sur {total} joueurs · {hands} main{hands > 1 ? 's' : ''} · niveau {level}
          <br />
          {share ? <>Dans les places payées : <b>{Math.round(share * 100)} %</b> des gains.</> : `Les ${pay.length} premiers sont payés. Ce sera pour la prochaine fois !`}
        </p>
        {ranking.length > 0 && (
          <ol className="end-ranking">
            {ranking.map((e) => (
              <li key={e.id} className={e.id === 'hero' ? 'me' : ''}>
                <span>{ordinalFR(e.place)}</span> {e.id === 'hero' ? 'Toi' : e.name}
              </li>
            ))}
          </ol>
        )}
        <div className="end-actions">
          {onReplay && <button className="primary" onClick={onReplay}>Rejouer un tournoi</button>}
          <button className={onReplay ? '' : 'primary'} onClick={onQuit}>Menu</button>
          <button className="ghost" onClick={() => setHidden(true)}>Voir la table</button>
        </div>
      </div>
    </div>
  );
}
