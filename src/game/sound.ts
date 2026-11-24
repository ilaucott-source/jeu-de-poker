/**
 * Sons de table : vrais enregistrements de jetons et de cartes
 * (packs « Casino Audio » et « Impact Sounds » de Kenney, licence CC0, dans public/sfx).
 */
const FILES = {
  lay: ['chip-lay-1', 'chip-lay-2', 'chip-lay-3'],
  stack: ['chips-stack-1', 'chips-stack-2', 'chips-stack-3', 'chips-stack-4', 'chips-stack-5', 'chips-stack-6'],
  handle: ['chips-handle-1', 'chips-handle-2', 'chips-handle-5'],
  collide: ['chips-collide-1', 'chips-collide-2', 'chips-collide-3', 'chips-collide-4'],
  slide: ['card-slide-1', 'card-slide-2', 'card-slide-3', 'card-slide-4'],
  place: ['card-place-1', 'card-place-2', 'card-place-3', 'card-place-4'],
  shove: ['card-shove-1', 'card-shove-2', 'card-shove-3'],
  knock: ['knock-1', 'knock-2', 'knock-3'],
} as const;
type Kind = keyof typeof FILES;

let ctx: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer>();
let loading: Promise<void> | null = null;
let muted = (() => {
  try {
    return localStorage.getItem('poker-muted') === '1';
  } catch {
    return false;
  }
})();

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem('poker-muted', m ? '1' : '0');
  } catch {
    /* stockage indisponible : le réglage reste en mémoire */
  }
}

function getCtx(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function load(a: AudioContext) {
  if (loading) return loading;
  const names = Object.values(FILES).flat();
  loading = Promise.all(
    names.map(async (n) => {
      try {
        const res = await fetch(`./sfx/${n}.mp3`);
        buffers.set(n, await a.decodeAudioData(await res.arrayBuffer()));
      } catch {
        /* un son manquant ne doit pas bloquer le jeu */
      }
    }),
  ).then(() => undefined);
  return loading;
}

/** Sur iPhone, le son doit être débloqué par un premier toucher. */
export function unlockAudio() {
  const a = getCtx();
  if (!a) return;
  void load(a);
  const s = a.createBufferSource();
  s.buffer = a.createBuffer(1, 1, 22050);
  s.connect(a.destination);
  s.start();
}

function play(kind: Kind, { gain = 0.8, delay = 0 } = {}) {
  if (muted) return;
  const a = getCtx();
  if (!a) return;
  void load(a);
  const list = FILES[kind];
  const buf = buffers.get(list[Math.floor(Math.random() * list.length)]);
  if (!buf) return;
  const src = a.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 0.95 + Math.random() * 0.1; // évite l'effet « même son répété »
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(g).connect(a.destination);
  src.start(a.currentTime + delay);
}

/** Mise posée : un jeton pour une petite mise, une pile pour une grosse, une poignée pour un tapis. */
export function playChips(sizeInBB: number) {
  if (sizeInBB <= 1.5) play('lay', { gain: 0.7 });
  else if (sizeInBB <= 12) play('stack');
  else if (sizeInBB <= 40) {
    play('stack');
    play('collide', { delay: 0.12, gain: 0.6 });
  } else play('handle', { gain: 0.9 });
}

/** Le gagnant ramasse le pot. */
export function playWin() {
  play('handle', { gain: 0.9 });
}

/** Distribution : une carte glisse par carte reçue. */
export function playDeal(cards = 2) {
  for (let i = 0; i < cards; i++) play('slide', { delay: i * 0.12, gain: 0.6 });
}

/** Cartes du tableau retournées. */
export function playBoard(cards: number) {
  for (let i = 0; i < cards; i++) play('place', { delay: i * 0.09, gain: 0.6 });
}

export const playFold = () => play('shove', { gain: 0.5 });

/** Parole : deux petits coups sur la table. */
export const playCheck = () => play('knock', { gain: 0.9 });
