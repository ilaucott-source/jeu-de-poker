import { useEffect, useState } from 'react';
import { ensureSyncLoaded, resetPassword, signIn, signOutSync, signUp, syncNow, useSyncStatus } from '../sync/cloud';

const ago = (t: number | null) => {
  if (!t) return 'jamais';
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? 'à l’instant' : s < 3600 ? `il y a ${Math.round(s / 60)} min` : new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/** Connexion au compte de synchronisation (même compte sur iPhone, iPad et ordinateur). */
export function SyncPanel({ onClose }: { onClose: () => void }) {
  const st = useSyncStatus();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => ensureSyncLoaded(), []);

  const run = async (f: () => Promise<void>, ok?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await f();
      if (ok) setMsg(ok);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="end-overlay" role="dialog" aria-label="Synchronisation">
      <div className="end-card sync-card">
        <h2>Mes appareils</h2>
        {st.user ? (
          <>
            <p className="end-sub">
              Connecté avec <b>{st.user.email}</b>.<br />
              {st.state === 'syncing' ? 'Synchronisation…' : st.state === 'offline' ? 'Hors connexion : tout sera envoyé au retour du réseau.' : st.state === 'error' ? 'La dernière synchronisation a échoué.' : `Synchronisé ${ago(st.lastSync)}.`}
            </p>
            <p className="note">Connecte-toi avec le même compte sur ton iPhone, ton iPad et ton ordinateur : ta partie en cours, tes mains et tes statistiques te suivent.</p>
            <div className="end-actions">
              <button className="primary" disabled={busy} onClick={() => run(syncNow)}>Synchroniser maintenant</button>
              <button disabled={busy} onClick={() => run(signOutSync)}>Se déconnecter</button>
              <button className="ghost" onClick={onClose}>Fermer</button>
            </div>
          </>
        ) : (
          <>
            <p className="end-sub">Crée un compte une fois, puis connecte-toi avec le même e-mail sur chaque appareil.</p>
            <form
              className="sync-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => signIn(email, pw));
              }}
            >
              <input type="email" autoComplete="email" placeholder="Ton e-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input type="password" autoComplete="current-password" placeholder="Mot de passe (6 caractères minimum)" value={pw} onChange={(e) => setPw(e.target.value)} />
              {msg && <p className="sync-msg">{msg}</p>}
              <div className="end-actions">
                <button className="primary" type="submit" disabled={busy}>Se connecter</button>
                <button type="button" disabled={busy} onClick={() => run(() => signUp(email, pw))}>Créer mon compte</button>
              </div>
              <div className="end-actions">
                <button type="button" className="ghost" disabled={busy || !email} onClick={() => run(() => resetPassword(email), 'Un e-mail pour choisir un nouveau mot de passe vient de t’être envoyé.')}>
                  Mot de passe oublié
                </button>
                <button type="button" className="ghost" onClick={onClose}>Fermer</button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
