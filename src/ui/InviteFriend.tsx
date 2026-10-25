import { useEffect, useState } from 'react';
import type { TraceBridge } from '../integrations/client';
import type { CameraShareState } from '../integrations/webrtc';
import './invite.css';
import { Heartbeat, WornTitle } from './Worn';

/** The one multiplayer surface: the link to send, what the friend sees, start or stop. The
 * bridge is read on a short timer because game time (and its re-render) is frozen meanwhile. */
export default function InviteFriend({ bridge, camera, cameraWanted, starting, onStart, onStop }: { bridge: TraceBridge | null; camera: CameraShareState; cameraWanted: boolean; starting: boolean; onStart: () => void; onStop: () => void }) {
  const [, tick] = useState(0), [copied, setCopied] = useState(false);
  useEffect(() => { const timer = setInterval(() => tick(n => n + 1), 300); return () => clearInterval(timer); }, []);
  const shareable = bridge?.shareableSpectateUrl() ?? null, link = shareable ?? bridge?.spectateUrl() ?? null, ready = !!bridge?.remoteReady;
  const connecting = !!bridge?.remoteConnecting;
  const note = !link || connecting ? 'Setting up the invitation…' : ready && shareable ? 'They can open it on any device.' : 'This link only works on this computer.';
  function copy() {
    if (!link || connecting) return;
    void navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => { /* The link remains selectable for manual copying. */ });
  }
  return <div className="modal-shade invite-shade"><section className="modal invite" role="dialog" aria-modal="true" aria-label="Play with a friend">
    <div className="screen-left">
    <WornTitle text="INVITE" level={2}/><Heartbeat/>
    <p className="invite-lead">Send them this link.</p>
    <div className="invite-link"><input readOnly aria-label="Spectate link" value={connecting ? '' : link ?? ''} onFocus={e => e.currentTarget.select()} /><button disabled={!link || connecting} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button></div>
    <p className="invite-note">{note}</p>
    <p className="invite-note">They get the puzzle manual and see your run and heart rate{cameraWanted ? ', plus your camera' : ''}. Nothing is recorded.</p>
    {cameraWanted && <p className="invite-note" role="status">{camera.status === 'live' ? camera.camera === 'ready' ? `Camera live · ${camera.viewers} watching` : 'Waiting for your camera' : camera.status === 'error' ? 'Camera unavailable. The manual still works.' : 'Connecting your camera…'}</p>}
    <div className="worn-menu"><button className="primary" onClick={onStart}>{starting ? 'Start' : 'Back to the shelter'} →</button><button onClick={onStop}>Stop sharing</button></div>
    </div>
  </section></div>;
}
