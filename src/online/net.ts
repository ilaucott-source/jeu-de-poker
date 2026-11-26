import { currentUid, ensureSyncLoaded, fb } from '../sync/cloud';
import type { CashGameOptions } from '../game/useCashGame';
import { HOST_ID, isCode, makeCode, type IntentDoc, type MemberDoc, type PrivateDoc, type TableDoc } from './protocol';
import type { HostSave } from './hostCore';

/** Accès Firestore pour les tables entre amis : tables/{code} et ses sous-collections. */

const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export class OnlineError extends Error {}

const ERR: Record<string, string> = {
  'permission-denied': 'Accès refusé par le serveur. Les règles de sécurité Firebase doivent être mises à jour pour le jeu entre amis.',
  unavailable: 'Pas de connexion internet.',
};
const wrap = async <T>(f: () => Promise<T>): Promise<T> => {
  try {
    return await f();
  } catch (e) {
    if (e instanceof OnlineError) throw e;
    const code = (e as { code?: string }).code ?? '';
    throw new OnlineError(ERR[code] ?? 'Une erreur est survenue. Réessaie.');
  }
};

export function requireUid(): string {
  const u = currentUid();
  if (!u) throw new OnlineError('Connecte-toi d’abord à ton compte.');
  return u;
}

export const tablePath = (code: string) => `tables/${code}`;

export function newSession() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Crée une table : l'hôte y est seul, en attendant ses amis. */
export async function createTable(opts: CashGameOptions, name: string, session: string): Promise<string> {
  ensureSyncLoaded();
  const uid = requireUid();
  return wrap(async () => {
    const { fs, db } = await fb();
    for (let tries = 0; tries < 5; tries++) {
      const code = makeCode();
      const ref = fs.doc(db, tablePath(code));
      if ((await fs.getDoc(ref)).exists()) continue;
      const now = Date.now();
      const doc: TableDoc = {
        v: 1,
        code,
        host: uid,
        hostName: name,
        hostSession: session,
        createdAt: now,
        ts: now,
        alive: now,
        status: 'lobby',
        opts,
        seats: [{ id: HOST_ID, name, kind: 'host', uid, stack: 0 }],
        handNo: 0,
        pub: null,
        eliminated: [],
        nextDealAt: null,
        paused: false,
      };
      await fs.setDoc(ref, clean(doc));
      await fs.setDoc(fs.doc(db, `${tablePath(code)}/members/${uid}`), clean({ name, ts: now } satisfies MemberDoc));
      return code;
    }
    throw new OnlineError('Impossible de créer la table. Réessaie.');
  });
}

export async function getTable(code: string): Promise<TableDoc | null> {
  return wrap(async () => {
    const { fs, db } = await fb();
    const snap = await fs.getDoc(fs.doc(db, tablePath(code)));
    return snap.exists() ? (snap.data() as TableDoc) : null;
  });
}

/** Rejoint une table avec son code. */
export async function joinTable(code: string, name: string): Promise<TableDoc> {
  ensureSyncLoaded();
  const uid = requireUid();
  if (!isCode(code)) throw new OnlineError('Ce code ne ressemble pas à un code de table (6 caractères).');
  const t = await getTable(code);
  if (!t) throw new OnlineError('Aucune table avec ce code. Vérifie-le auprès de ton ami.');
  if (t.status === 'over') throw new OnlineError('Cette partie est terminée.');
  const seated = t.seats.some((s) => s.uid === uid);
  if (!seated && t.status === 'playing' && t.opts.mode === 'tournament') throw new OnlineError('Ce tournoi a déjà commencé : impossible de le rejoindre en cours.');
  await wrap(async () => {
    const { fs, db } = await fb();
    await fs.setDoc(fs.doc(db, `${tablePath(code)}/members/${uid}`), clean({ name, ts: Date.now() } satisfies MemberDoc));
  });
  return t;
}

export async function leaveTable(code: string) {
  const uid = currentUid();
  if (!uid) return;
  await wrap(async () => {
    const { fs, db } = await fb();
    await fs.setDoc(fs.doc(db, `${tablePath(code)}/members/${uid}`), { left: true, ts: Date.now() }, { merge: true });
  }).catch(() => undefined);
}

type Unsub = () => void;

export async function watchTable(code: string, cb: (t: TableDoc | null) => void, onErr?: (m: string) => void): Promise<Unsub> {
  const { fs, db } = await fb();
  return fs.onSnapshot(
    fs.doc(db, tablePath(code)),
    (s) => cb(s.exists() ? (s.data() as TableDoc) : null),
    (e) => onErr?.(ERR[(e as { code?: string }).code ?? ''] ?? 'Connexion à la table perdue.'),
  );
}

export async function watchMembers(code: string, cb: (m: Record<string, MemberDoc>) => void): Promise<Unsub> {
  const { fs, db } = await fb();
  return fs.onSnapshot(fs.collection(db, `${tablePath(code)}/members`), (s) => cb(Object.fromEntries(s.docs.map((d) => [d.id, d.data() as MemberDoc]))));
}

export async function watchIntents(code: string, cb: (uid: string, i: IntentDoc) => void): Promise<Unsub> {
  const { fs, db } = await fb();
  return fs.onSnapshot(fs.collection(db, `${tablePath(code)}/intents`), (s) =>
    s.docChanges().forEach((c) => {
      if (c.type !== 'removed') cb(c.doc.id, c.doc.data() as IntentDoc);
    }),
  );
}

export async function watchPrivate(code: string, uid: string, cb: (p: PrivateDoc | null) => void): Promise<Unsub> {
  const { fs, db } = await fb();
  return fs.onSnapshot(fs.doc(db, `${tablePath(code)}/private/${uid}`), (s) => cb(s.exists() ? (s.data() as PrivateDoc) : null));
}

export async function sendIntent(code: string, i: IntentDoc) {
  const uid = requireUid();
  const { fs, db } = await fb();
  await fs.setDoc(fs.doc(db, `${tablePath(code)}/intents/${uid}`), clean(i));
}

export async function writeTable(code: string, patch: Partial<TableDoc>) {
  const { fs, db } = await fb();
  await fs.setDoc(fs.doc(db, tablePath(code)), clean(patch), { merge: true });
}

export async function writePrivate(code: string, uid: string, p: PrivateDoc) {
  const { fs, db } = await fb();
  await fs.setDoc(fs.doc(db, `${tablePath(code)}/private/${uid}`), clean(p));
}

export async function writeHostState(code: string, save: HostSave) {
  const { fs, db } = await fb();
  await fs.setDoc(fs.doc(db, `${tablePath(code)}/host/state`), { save: JSON.stringify(save), ts: Date.now() });
}

export async function readHostState(code: string): Promise<HostSave | null> {
  return wrap(async () => {
    const { fs, db } = await fb();
    const s = await fs.getDoc(fs.doc(db, `${tablePath(code)}/host/state`));
    return s.exists() ? (JSON.parse((s.data() as { save: string }).save) as HostSave) : null;
  });
}

/** Tables créées par ce compte et pas terminées (pour les reprendre, ici ou sur un autre appareil). */
export async function myHostedTables(): Promise<TableDoc[]> {
  const uid = currentUid();
  if (!uid) return [];
  return wrap(async () => {
    const { fs, db } = await fb();
    const q = fs.query(fs.collection(db, 'tables'), fs.where('host', '==', uid));
    const s = await fs.getDocs(q);
    return s.docs
      .map((d) => d.data() as TableDoc)
      .filter((t) => t.status !== 'over' && Date.now() - t.ts < 7 * 24 * 3600_000)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 5);
  });
}
