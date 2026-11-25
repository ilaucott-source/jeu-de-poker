import { useEffect, useState } from 'react';
import { FIREBASE_CONFIG, USE_EMULATOR } from './config';
import { loadHands, loadTourneys, mergeHands, mergeTourneys, onHistoryChange, type HandRecord } from '../game/history';
import { clearGame, loadGame, onSaveChange, saveGame, type SavedGame } from '../game/save';

/**
 * Synchronisation entre appareils avec Firebase (compte e-mail + mot de passe).
 * Chaque joueur a son propre espace : users/{uid}/hands, users/{uid}/tourneys, users/{uid}/state/main.
 * Le SDK Firebase n'est chargé que si la synchronisation est configurée et utilisée.
 */

export const syncAvailable = !!FIREBASE_CONFIG;

export interface SyncStatus {
  user: { email: string } | null;
  state: 'off' | 'idle' | 'syncing' | 'error' | 'offline';
  lastSync: number | null;
  message?: string;
}

let status: SyncStatus = { user: null, state: syncAvailable ? 'idle' : 'off', lastSync: null };
const subs = new Set<(s: SyncStatus) => void>();
const set = (p: Partial<SyncStatus>) => {
  status = { ...status, ...p };
  subs.forEach((f) => f(status));
};

export function useSyncStatus() {
  const [s, setS] = useState(status);
  useEffect(() => {
    subs.add(setS);
    return () => {
      subs.delete(setS);
    };
  }, []);
  return s;
}

type Fb = Awaited<ReturnType<typeof loadFirebase>>;
let fbPromise: Promise<Fb> | null = null;
async function loadFirebase() {
  const [{ initializeApp }, auth, fs] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]);
  const app = initializeApp(FIREBASE_CONFIG!);
  const a = auth.initializeAuth(app, { persistence: [auth.indexedDBLocalPersistence, auth.browserLocalPersistence] });
  const db = fs.getFirestore(app);
  if (USE_EMULATOR) {
    auth.connectAuthEmulator(a, 'http://127.0.0.1:9099', { disableWarnings: true });
    fs.connectFirestoreEmulator(db, '127.0.0.1', 8085);
  }
  return { auth, fs, a, db };
}
const fb = () => (fbPromise ??= loadFirebase());

const ERR_FR: Record<string, string> = {
  'auth/invalid-email': 'Adresse e-mail invalide.',
  'auth/missing-password': 'Indique un mot de passe.',
  'auth/weak-password': 'Mot de passe trop court (6 caractères minimum).',
  'auth/email-already-in-use': 'Un compte existe déjà avec cet e-mail : choisis « Se connecter ».',
  'auth/invalid-credential': 'E-mail ou mot de passe incorrect.',
  'auth/wrong-password': 'E-mail ou mot de passe incorrect.',
  'auth/user-not-found': 'Aucun compte avec cet e-mail : choisis « Créer mon compte ».',
  'auth/too-many-requests': 'Trop d’essais. Réessaie dans quelques minutes.',
  'auth/network-request-failed': 'Pas de connexion internet.',
};
const errFr = (e: unknown) => ERR_FR[(e as { code?: string }).code ?? ''] ?? 'Une erreur est survenue. Réessaie.';

export async function signUp(email: string, password: string) {
  const { auth, a } = await fb();
  try {
    await auth.createUserWithEmailAndPassword(a, email.trim(), password);
  } catch (e) {
    throw new Error(errFr(e));
  }
}
export async function signIn(email: string, password: string) {
  const { auth, a } = await fb();
  try {
    await auth.signInWithEmailAndPassword(a, email.trim(), password);
  } catch (e) {
    throw new Error(errFr(e));
  }
}
export async function resetPassword(email: string) {
  const { auth, a } = await fb();
  try {
    await auth.sendPasswordResetEmail(a, email.trim());
  } catch (e) {
    throw new Error(errFr(e));
  }
}
export async function signOutSync() {
  const { auth, a } = await fb();
  await auth.signOut(a);
}

let uid: string | null = null;
let started = false;

/** À appeler au démarrage : reconnecte le compte mémorisé et branche la synchronisation. */
export function startSync() {
  if (!syncAvailable || started) return;
  started = true;
  // on ne charge Firebase au démarrage que si un compte a déjà été utilisé sur cet appareil
  const known = localStorage.getItem('poker-sync-user');
  if (!known) {
    set({ state: 'idle' });
  }
  const boot = async () => {
    const { auth, a } = await fb();
    auth.onAuthStateChanged(a, (u) => {
      uid = u?.uid ?? null;
      if (u) {
        localStorage.setItem('poker-sync-user', u.email ?? '1');
        set({ user: { email: u.email ?? '' } });
        void syncNow();
      } else {
        localStorage.removeItem('poker-sync-user');
        set({ user: null, state: 'idle', lastSync: null });
      }
    });
  };
  if (known) void boot();
  else bootLater = boot;

  // envois au fil de l'eau
  onHistoryChange((c) => {
    if (!uid) return;
    if (c.kind === 'hand') void pushHand(c.hand);
    else if (c.kind === 'tourney') void push(`tourneys/${c.t.ts}`, c.t);
    else void wipeRemote();
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  onSaveChange((g) => {
    if (!uid || pulling) return;
    // la partie en cours change à chaque action : on regroupe les envois
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void pushState(g), g?.hand?.street === 'complete' || !g ? 300 : 4000);
  });
  document.addEventListener('visibilitychange', () => {
    if (!uid) return;
    if (document.visibilityState === 'hidden') void pushState(loadGame());
    else void syncNow();
  });
  window.addEventListener('online', () => uid && void syncNow());
}
let bootLater: (() => Promise<void>) | null = null;
/** Charge Firebase à la demande (quand le joueur ouvre l'écran de connexion). */
export function ensureSyncLoaded() {
  if (bootLater) {
    const b = bootLater;
    bootLater = null;
    void b();
  }
}

async function push(path: string, data: unknown) {
  if (!uid) return;
  const { fs, db } = await fb();
  try {
    await fs.setDoc(fs.doc(db, `users/${uid}/${path}`), JSON.parse(JSON.stringify(data)));
    set({ lastSync: Date.now(), state: 'idle' });
  } catch {
    set({ state: navigator.onLine ? 'error' : 'offline' });
  }
}
const pushHand = (h: HandRecord) => push(`hands/${h.id}`, h);
async function pushState(g: SavedGame | null) {
  await push('state/main', { save: g ? JSON.stringify(g) : null, ts: g?.ts ?? Date.now(), menu: localStorage.getItem('poker-menu') });
}

async function wipeRemote() {
  if (!uid) return;
  const { fs, db } = await fb();
  for (const col of ['hands', 'tourneys']) {
    const snap = await fs.getDocs(fs.collection(db, `users/${uid}/${col}`));
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = fs.writeBatch(db);
      snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
}

let pulling = false;
let syncing: Promise<void> | null = null;
/** Synchronisation complète : on récupère ce qui manque ici, on envoie ce qui manque là-bas. */
export function syncNow(): Promise<void> {
  return (syncing ??= (async () => {
    if (!uid) return;
    set({ state: 'syncing' });
    try {
      const { fs, db } = await fb();
      // mains
      const snap = await fs.getDocs(fs.collection(db, `users/${uid}/hands`));
      const remote = snap.docs.map((d) => d.data() as HandRecord);
      const remoteIds = new Set(remote.map((h) => h.id));
      mergeHands(remote);
      const missing = loadHands().filter((h) => !remoteIds.has(h.id));
      for (let i = 0; i < missing.length; i += 400) {
        const batch = fs.writeBatch(db);
        missing.slice(i, i + 400).forEach((h) => batch.set(fs.doc(db, `users/${uid}/hands/${h.id}`), JSON.parse(JSON.stringify(h))));
        await batch.commit();
      }
      // tournois
      const ts = await fs.getDocs(fs.collection(db, `users/${uid}/tourneys`));
      const remoteT = ts.docs.map((d) => d.data() as ReturnType<typeof loadTourneys>[number]);
      const rt = new Set(remoteT.map((t) => t.ts));
      mergeTourneys(remoteT);
      for (const t of loadTourneys().filter((t) => !rt.has(t.ts))) await push(`tourneys/${t.ts}`, t);
      // partie en cours : la plus récente gagne
      const st = await fs.getDoc(fs.doc(db, `users/${uid}/state/main`));
      const local = loadGame();
      const data = st.exists() ? (st.data() as { save: string | null; ts: number; menu: string | null }) : null;
      const remoteGame = data?.save ? (JSON.parse(data.save) as SavedGame) : null;
      if (remoteGame && (!local || remoteGame.ts > local.ts)) {
        pulling = true;
        saveGame(remoteGame);
        if (data?.menu) localStorage.setItem('poker-menu', data.menu);
        pulling = false;
      } else if (data && !data.save && local && data.ts > local.ts) {
        // partie terminée ou abandonnée sur un autre appareil
        pulling = true;
        clearGame();
        pulling = false;
      } else if (local && (!data || local.ts > data.ts)) {
        await pushState(local);
      }
      set({ state: 'idle', lastSync: Date.now(), message: undefined });
    } catch {
      set({ state: navigator.onLine ? 'error' : 'offline' });
    }
  })().finally(() => {
    syncing = null;
  }));
}
