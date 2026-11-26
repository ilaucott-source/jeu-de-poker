import { useEffect, useMemo, useState } from 'react';
import { LEVEL_FR } from '../engine/bots';
import { VARIANT_FR } from '../engine/variant';
import type { CashGameOptions } from '../game/useCashGame';
import { currentUid, ensureSyncLoaded, useSyncStatus } from '../sync/cloud';
import { createTable, leaveTable, myHostedTables, joinTable, newSession, OnlineError, writeTable } from '../online/net';
import { isCode, normalizeCode, type TableDoc } from '../online/protocol';
import { openAsGuest, openAsHost, type OnlineConn } from '../online/runtime';
import { useOnlineGame } from '../online/useOnlineGame';
import { HERO_ID } from '../game/useCashGame';
import { SyncPanel } from './SyncPanel';
import { TableView } from './Table';
import { TIMER_PRESETS } from '../game/timer';

const STRUCTURE_FR = { NL: 'No Limit', PL: 'Pot Limit', FL: 'Limit' };
const LAST_KEY = 'poker-online-last';
const NAME_KEY = 'poker-pseudo';

const readLast = (): { code: string; host: boolean } | null => {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null');
  } catch {
    return null;
  }
};
const writeLast = (v: { code: string; host: boolean } | null) => {
  try {
    if (v) localStorage.setItem(LAST_KEY, JSON.stringify(v));
    else localStorage.removeItem(LAST_KEY);
  } catch {
    /* rien */
  }
};

const optsSummary = (o: CashGameOptions) =>
  `${VARIANT_FR[o.variant ?? 'holdem']} ${STRUCTURE_FR[o.structure]} · ${o.mode === 'tournament' ? 'tournoi' : `cash game, blinds ${o.bigBlind / 2}/${o.bigBlind}`} · ${o.bots + 1} places · bots ${LEVEL_FR[o.level].toLowerCase()} · ${TIMER_PRESETS[o.timer].label.toLowerCase()}`;

/** Jouer avec des amis : créer ou rejoindre une table, salon d'attente, puis la partie. */
export function OnlineScreen({ opts, initialCode, onClose }: { opts: CashGameOptions; initialCode?: string | null; onClose: () => void }) {
  const sync = useSyncStatus();
  const [conn, setConn] = useState<OnlineConn | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [code, setCode] = useState(initialCode ?? '');
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [signIn, setSignIn] = useState(false);
  const [hosted, setHosted] = useState<TableDoc[]>([]);
  const last = readLast();
  useEffect(() => ensureSyncLoaded(), []);
  useEffect(() => {
    if (!sync.user) return;
    if (!name) setName(sync.user.email.split('@')[0].slice(0, 16));
    myHostedTables()
      .then(setHosted)
      .catch(() => setHosted([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.user]);
  useEffect(() => () => conn?.close(), [conn]);

  const pseudo = name.trim().slice(0, 16) || 'Joueur';
  const saveName = () => {
    try {
      localStorage.setItem(NAME_KEY, pseudo);
    } catch {
      /* rien */
    }
  };
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await f();
    } catch (e) {
      setMsg(e instanceof OnlineError ? e.message : 'Une erreur est survenue. Vérifie ta connexion et réessaie.');
    } finally {
      setBusy(false);
    }
  };
  const create = () =>
    run(async () => {
      saveName();
      const c = await createTable(opts, pseudo, newSession());
      writeLast({ code: c, host: true });
      setConn(await openAsHost(c));
    });
  const resumeHost = (c: string) =>
    run(async () => {
      writeLast({ code: c, host: true });
      setConn(await openAsHost(c));
    });
  const join = (raw: string) =>
    run(async () => {
      saveName();
      const c = normalizeCode(raw);
      const t = await joinTable(c, pseudo);
      if (t.host === currentUid()) {
        writeLast({ code: c, host: true });
        setConn(await openAsHost(c));
        return;
      }
      writeLast({ code: c, host: false });
      setConn(await openAsGuest(c));
    });

  if (conn) return <OnlineRoom conn={conn} onExit={() => setConn(null)} onClose={onClose} />;

  return (
    <div className="menu-screen">
      <div className="menu online-menu">
        <div className="brand">
          <span className="emblem" aria-hidden="true"><span>♣</span></span>
          <h1>Entre amis</h1>
          <p className="sub">Une table privée, un code à partager</p>
        </div>
        {!sync.user ? (
          <>
            <p className="note">Pour jouer ensemble, chacun se connecte avec son compte (le même que pour retrouver ses parties sur tous ses appareils). Tes amis créent le leur en un instant, c’est gratuit.</p>
            <button className="primary big" onClick={() => setSignIn(true)}>Me connecter ou créer mon compte</button>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="pseudo">Ton nom à la table</label>
              <input id="pseudo" className="text-input" maxLength={16} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ton prénom" />
            </div>
            <div className="online-cards">
              <div className="online-card">
                <b>Rejoindre une table</b>
                <small>Entre le code reçu de ton ami.</small>
                <form
                  className="join-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void join(code);
                  }}
                >
                  <input className="text-input code-input" value={code} onChange={(e) => setCode(normalizeCode(e.target.value))} placeholder="CODE" autoCapitalize="characters" autoComplete="off" inputMode="text" aria-label="Code de la table" />
                  <button className="primary" type="submit" disabled={busy || !isCode(normalizeCode(code))}>Rejoindre</button>
                </form>
              </div>
              <div className="online-card">
                <b>Créer une table</b>
                <small>{optsSummary(opts)}</small>
                <small className="muted">Les réglages sont ceux du menu. Les places libres sont prises par des bots.</small>
                <button className="primary" disabled={busy} onClick={create}>Créer la table</button>
              </div>
            </div>
            {(hosted.length > 0 || (last && !last.host)) && (
              <div className="field">
                <span>Reprendre</span>
                {hosted.map((t) => (
                  <div className="resume-card" key={t.code}>
                    <div>
                      <b>Ta table {t.code}</b>
                      <small>
                        {optsSummary(t.opts)} · {t.status === 'lobby' ? 'pas encore commencée' : `main n°${t.handNo}`}
                      </small>
                    </div>
                    <button className="primary" disabled={busy} onClick={() => resumeHost(t.code)}>Reprendre</button>
                    <button className="ghost" disabled={busy} onClick={() => void writeTable(t.code, { status: 'over', ts: Date.now() }).then(() => setHosted((h) => h.filter((x) => x.code !== t.code)))}>
                      Fermer
                    </button>
                  </div>
                ))}
                {last && !last.host && (
                  <div className="resume-card">
                    <div>
                      <b>Table {last.code}</b>
                      <small>la dernière table que tu as rejointe</small>
                    </div>
                    <button className="primary" disabled={busy} onClick={() => join(last.code)}>Retourner</button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {msg && <p className="sync-msg">{msg}</p>}
        <button className="progress-link" onClick={onClose}>‹ Retour au menu</button>
        {signIn && <SyncPanel onClose={() => setSignIn(false)} />}
      </div>
    </div>
  );
}

function OnlineRoom({ conn, onExit, onClose }: { conn: OnlineConn; onExit: () => void; onClose: () => void }) {
  const game = useOnlineGame(conn);
  const { snap } = game;
  const leave = () => {
    if (conn.isHost) {
      if (snap.status === 'playing' && !window.confirm('Quitter la table ? La partie se met en pause pour tes amis. Tu pourras la reprendre depuis « Jouer avec des amis ».')) return;
      conn.close();
    } else {
      if (snap.status === 'playing' && snap.seated && !window.confirm('Quitter la table ? Un bot prendra ta place.')) return;
      void leaveTable(conn.code);
      writeLast(null);
      conn.close();
    }
    onExit();
  };
  const online = useMemo(
    () => ({
      code: snap.code,
      isHost: snap.isHost,
      nextDealAt: snap.nextDealAt,
      paused: snap.paused,
      setPaused: (p: boolean) => conn.setPaused(p),
      away: snap.away,
      back: () => conn.back(),
      hostAway: snap.hostAway,
      hostName: snap.hostName,
      error: snap.error,
      awayIds: snap.seats.filter((s) => s.away).map((s) => s.id),
      spectator: !snap.hand?.players.some((p) => p.id === HERO_ID),
    }),
    [snap, conn],
  );

  if (snap.takenOver)
    return (
      <Notice title="Partie reprise ailleurs" onBack={onExit}>
        Cette table tourne maintenant sur un autre de tes appareils.
      </Notice>
    );
  if (snap.status === 'lobby' || (!snap.hand && snap.status !== 'over') || (!snap.seated && snap.opts.mode === 'tournament' && snap.status === 'playing'))
    return <Lobby conn={conn} onLeave={leave} />;
  if (snap.status === 'over' && !snap.hand)
    return (
      <Notice title="Partie terminée" onBack={onClose}>
        Cette table est fermée.
      </Notice>
    );
  return <TableView options={snap.opts} game={game} online={online} onQuit={leave} onReplay={leave} />;
}

function Notice({ title, children, onBack }: { title: string; children: React.ReactNode; onBack: () => void }) {
  return (
    <div className="end-overlay" role="dialog" aria-label={title}>
      <div className="end-card">
        <h2>{title}</h2>
        <p className="end-sub">{children}</p>
        <div className="end-actions">
          <button className="primary" onClick={onBack}>Retour</button>
        </div>
      </div>
    </div>
  );
}

/** Salon d'attente : le code à partager, les amis arrivés, le bouton pour lancer. */
function Lobby({ conn, onLeave }: { conn: OnlineConn; onLeave: () => void }) {
  const snap = conn.snapshot();
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}${location.pathname}?table=${snap.code}`;
  const places = snap.opts.bots + 1;
  const share = async () => {
    const text = `Viens jouer au poker avec moi ! Code de la table : ${snap.code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Jeu de Poker', text, url: link });
      else {
        await navigator.clipboard.writeText(`${text}\n${link}`);
        setCopied(true);
      }
    } catch {
      /* partage annulé */
    }
  };
  const blocked = !snap.isHost && snap.status === 'playing' && !snap.seated;
  return (
    <div className="menu-screen">
      <div className="menu online-menu">
        <div className="brand">
          <span className="emblem" aria-hidden="true"><span>♣</span></span>
          <h1>Table {snap.code}</h1>
          <p className="sub">{snap.opts.variant ? optsSummary(snap.opts) : ''}</p>
        </div>
        {blocked ? (
          <p className="note">Ce tournoi a déjà commencé : il n’est plus possible de s’y asseoir.</p>
        ) : (
          <>
            <div className="code-big" aria-label="Code de la table">{snap.code}</div>
            <button className="pill share-btn" onClick={share}>{copied ? 'Lien copié ✓' : 'Partager le lien d’invitation'}</button>
            <div className="field">
              <span>
                À la table ({snap.lobby.length}/{places})
              </span>
              <ul className="lobby-list">
                {snap.lobby.map((p, i) => (
                  <li key={p.uid}>
                    <span className="avatar me friend">{p.name.charAt(0).toUpperCase()}</span> {p.name} {i === 0 && <small>· hôte</small>}
                  </li>
                ))}
                {Array.from({ length: Math.max(0, places - snap.lobby.length) }, (_, i) => (
                  <li key={`b${i}`} className="muted">
                    <span className="avatar me">♠</span> place libre (un bot si personne ne vient)
                  </li>
                ))}
              </ul>
            </div>
            {snap.isHost ? (
              <>
                <p className="note">Garde l’application ouverte pendant la partie : c’est ton appareil qui distribue les cartes.</p>
                <button className="primary big" onClick={() => conn.start()}>Lancer la partie</button>
              </>
            ) : (
              <p className="note">{snap.status === 'playing' ? 'Tu prendras place à la prochaine main…' : `En attente du lancement par ${snap.hostName}…`}</p>
            )}
          </>
        )}
        {snap.error && <p className="sync-msg">{snap.error}</p>}
        <button className="progress-link" onClick={onLeave}>‹ Quitter la table</button>
      </div>
    </div>
  );
}

