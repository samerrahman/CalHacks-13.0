import { useEffect, useState } from 'react';
import type { TraceBridge } from '../integrations/client';
import './invite.css';

/** The one multiplayer surface: the link to send, what the friend sees, start or stop. The
 * bridge is read on a short timer because game time (and its re-render) is frozen meanwhile. */
export default function InviteFriend({ bridge, starting, onStart, onStop }: { bridge: TraceBridge | null; starting: boolean; onStart: () => void; onStop: () => void }) {
  const [, tick] = useState(0), [copied, setCopied] = useState(false);
  useEffect(() => { const timer = setInterval(() => tick(n => n + 1), 300); return () => clearInterval(timer); }, []);
  const shareable = bridge?.shareableSpectateUrl() ?? null, link = shareable ?? bridge?.spectateUrl() ?? null, ready = !!bridge?.remoteReady;
  const note = !link ? 'Setting up the link…' : !import.meta.env?.VITE_SPACETIMEDB_DB_NAME ? 'Same-browser link only: this build has no SpacetimeDB database configured.' : !ready ? 'Connecting to SpacetimeDB… until then the link only works in this browser.' : shareable ? 'Live link. Your friend can open it on any device.' : 'Live, but this link only opens on this computer. To invite someone elsewhere, set VITE_SPECTATE_ORIGIN to a hosted copy of the game.';
  function copy() { if (!link) return; void navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }
  return <div className="modal-shade"><section className="modal invite" role="dialog" aria-modal="true" aria-label="Play with a friend">
    <div className="eyebrow">PLAY WITH A FRIEND</div>
    <h2>Send them this link.</h2>
    <div className="invite-link"><input readOnly aria-label="Spectate link" value={link ?? ''} onFocus={e => e.currentTarget.select()} /><button disabled={!link} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button></div>
    <p className="small muted">{note}</p>
    <p className="small">They watch the run live and see your current heart rate. Nothing is recorded, and they cannot change your game.</p>
    <button className="primary" onClick={onStart}>{starting ? 'Start' : 'Back to the shelter'} <span>→</span></button>
    <button className="text-button" onClick={onStop}>Stop sharing</button>
  </section></div>;
}
