import type { Card } from '../engine/cards';

const SUIT_SYMBOL: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANK_LABEL: Record<string, string> = { T: '10', J: 'V', Q: 'D', K: 'R', A: 'A' };

export function CardView({ card, hidden, small }: { card?: Card; hidden?: boolean; small?: boolean }) {
  if (!card || hidden) return <div className={`card back ${small ? 'small' : ''}`} />;
  const suit = card[1];
  const red = suit === 'h' || suit === 'd';
  return (
    <div className={`card ${red ? 'red' : ''} ${small ? 'small' : ''} suit-${suit}`}>
      <span className="rank">{RANK_LABEL[card[0]] ?? card[0]}</span>
      <span className="suit">{SUIT_SYMBOL[suit]}</span>
    </div>
  );
}
