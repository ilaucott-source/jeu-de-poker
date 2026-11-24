import type { Card } from '../engine/cards';

const SUIT_SYMBOL: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SUIT_NAME: Record<string, string> = { s: 'pique', h: 'cœur', d: 'carreau', c: 'trèfle' };
const RANK_LABEL: Record<string, string> = { T: '10', J: 'V', Q: 'D', K: 'R', A: 'A' };

type Size = 'lg' | 'md' | 'sm';

export function CardView({ card, hidden, size = 'md', delay = 0 }: { card?: Card; hidden?: boolean; size?: Size; delay?: number }) {
  const style = delay ? { animationDelay: `${delay}ms` } : undefined;
  if (!card || hidden) return <div className={`card back ${size}`} style={style} aria-label="carte cachée" />;
  const suit = card[1];
  const rank = RANK_LABEL[card[0]] ?? card[0];
  const red = suit === 'h' || suit === 'd';
  return (
    <div className={`card face ${size} ${red ? 'red' : 'black'}`} style={style} aria-label={`${rank} de ${SUIT_NAME[suit]}`}>
      <span className="idx">
        <span className="r">{rank}</span>
        <span className="s">{SUIT_SYMBOL[suit]}</span>
      </span>
      <span className="pip">{SUIT_SYMBOL[suit]}</span>
      <span className="idx flip">
        <span className="r">{rank}</span>
        <span className="s">{SUIT_SYMBOL[suit]}</span>
      </span>
    </div>
  );
}
