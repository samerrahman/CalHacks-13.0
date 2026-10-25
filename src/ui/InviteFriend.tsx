import { useEffect, useState } from 'react';
import type { TraceBridge } from '../integrations/client';
import type { CameraShareState } from '../integrations/webrtc';
import './invite.css';

/** The one multiplayer surface: the link to send, what the friend sees, start or stop. The
 * bridge is read on a short timer because game time (and its re-render) is frozen meanwhile. */
export default function InviteFriend({ bridge, camera, cameraWanted, starting, onStart, onStop }: { bridge: TraceBridge | null; camera: CameraShareState; cameraWanted: boolean; starting: boolean; onStart: () => void; onStop: () => void }) {
  const [, tick] = useState(0), [copied, setCopied] = useState(false);
  useEffect(() => { const timer = setInterval(() => tick(n => n + 1), 300); return () => clearInterval(timer); }, []);
  const shareable = bridge?.shareableSpectateUrl() ?? null, link = shareable ?? bridge?.spectateUrl() ?? null, ready = !!bridge?.remoteReady;
  const connecting = !!bridge?.remoteConnecting;
  const note = !link || connecting ? 'Setting up the invitation…' : ready && shareable ? 'Your friend can open this link on their device.' : 'This link only works on this computer. Online invitations are not available in this build yet.';
  function copy() {
    if (!link || connecting) return;
    void navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => { /* The link remains selectable for manual copying. */ });
  }
  return <div className="modal-shade"><section className="modal invite" role="dialog" aria-modal="true" aria-label="Play with a friend">
    <div className="eyebrow">PLAY WITH A FRIEND</div>
    <h2>Send them this link.</h2>
    <div className="invite-link"><input readOnly aria-label="Spectate link" value={connecting ? '' : link ?? ''} onFocus={e => e.currentTarget.select()} /><button disabled={!link || connecting} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button></div>
    <p className="small muted">{note}</p>
    <p className="small">They hold the puzzle manual and talk you through the shelter. They also see your run and current heart rate{cameraWanted ? ', plus your live camera when available' : ''}. Video is never recorded. Game events expire after 24 hours.</p>
    {cameraWanted && <p className="small muted" role="status">{camera.status === 'live' ? camera.camera === 'ready' ? `Camera live · ${camera.viewers} watching` : 'Waiting for your camera' : camera.status === 'error' ? 'Live camera unavailable. The manual and game view still work.' : 'Connecting your camera…'}</p>}
    <button className="primary" onClick={onStart}>{starting ? 'Start' : 'Back to the shelter'} <span>→</span></button>
    <button className="text-button" onClick={onStop}>Stop sharing</button>
  </section></div>;
}
