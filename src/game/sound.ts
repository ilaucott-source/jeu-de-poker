/** Sons de table générés à la volée (aucun fichier à télécharger). */
let ctx: AudioContext | null = null;
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
    /* stockage indisponible : on garde le réglage en mémoire */
  }
}

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Sur iPhone, le son doit être débloqué par un premier toucher. */
export function unlockAudio() {
  const a = audio();
  if (!a) return;
  const b = a.createBuffer(1, 1, 22050);
  const s = a.createBufferSource();
  s.buffer = b;
  s.connect(a.destination);
  s.start();
}

function noiseBuffer(a: AudioContext, seconds: number) {
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * seconds), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  return buf;
}

/** Un jeton qui tape sur un autre : petit claquement + résonance métallique/céramique. */
function clack(a: AudioContext, when: number, gain = 0.5) {
  const n = a.createBufferSource();
  n.buffer = noiseBuffer(a, 0.03);
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 3200 + Math.random() * 1800;
  bp.Q.value = 4;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.04);
  n.connect(bp).connect(g).connect(a.destination);
  n.start(when);

  const o = a.createOscillator();
  o.type = 'triangle';
  o.frequency.value = 2400 + Math.random() * 1400;
  const og = a.createGain();
  og.gain.setValueAtTime(gain * 0.25, when);
  og.gain.exponentialRampToValueAtTime(0.0005, when + 0.09);
  o.connect(og).connect(a.destination);
  o.start(when);
  o.stop(when + 0.1);
}

/** Jetons posés sur la table ; plus la mise est grosse, plus il y a de jetons. */
export function playChips(count = 3) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.01;
  const n = Math.max(2, Math.min(7, count));
  for (let i = 0; i < n; i++) clack(a, t + i * (0.035 + Math.random() * 0.03), 0.35 + Math.random() * 0.2);
}

/** Le pot glisse vers le gagnant : cascade de jetons. */
export function playWin() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.05;
  for (let i = 0; i < 12; i++) clack(a, t + i * 0.028 + Math.random() * 0.012, 0.25 + Math.random() * 0.2);
}

function swish(duration: number, freq: number, gain: number) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.01;
  const n = a.createBufferSource();
  n.buffer = noiseBuffer(a, duration);
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(freq, t);
  f.frequency.exponentialRampToValueAtTime(freq * 0.5, t + duration);
  f.Q.value = 0.8;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + duration * 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  n.connect(f).connect(g).connect(a.destination);
  n.start(t);
}

export const playDeal = () => swish(0.12, 2600, 0.18);
export const playFold = () => swish(0.22, 1400, 0.12);

/** Deux petits coups sur le tapis pour « parole ». */
export function playCheck() {
  const a = audio();
  if (!a) return;
  for (const dt of [0, 0.11]) {
    const t = a.currentTime + 0.01 + dt;
    const o = a.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.06);
    const g = a.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + 0.1);
  }
}
