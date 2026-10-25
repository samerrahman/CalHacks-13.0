import { useEffect, useState } from 'react';
import type { TraceBridge } from '../integrations/client';
import type { CameraShareState } from '../integrations/webrtc';
import './invite.css';
import { Heartbeat, WornTitle } from './Worn';

/** The one multiplayer surface: the link to send, what the friend sees, start or stop. The
 * bridge is read on a short timer because game time (and its re-render) is frozen meanwhile. */
export default function InviteFriend({ bridge, camera, cameraWanted, onToggleCamera, vitalsShare, onVitalsConsent, voice, voiceState, onVoice, starting, onStart, onStop }: { bridge: TraceBridge | null; camera: CameraShareState; cameraWanted: boolean; onToggleCamera: (on: boolean) => void; vitalsShare: boolean; onVitalsConsent: (on: boolean) => void; voice: boolean; voiceState: { mic: 'off' | 'opening' | 'live' | 'denied'; friends: number }; onVoice: (on: boolean) => void; starting: boolean; onStart: () => void; onStop: () => void }) {
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
    <p className="invite-note">They get the puzzle manual and see your run{vitalsShare ? ', how scared you are, and your heart rate, breathing, expression, blink rate and heart-rate variability' : ''}{cameraWanted ? ', plus your camera' : ''}. Nothing is recorded.</p>
    <fieldset className="invite-sharing"><legend>What they see live</legend>
      <label className="check"><input type="checkbox" checked={cameraWanted} onChange={e => onToggleCamera(e.target.checked)} /> Share live webcam video</label>
      <label className="check"><input type="checkbox" checked={vitalsShare} onChange={e => onVitalsConsent(e.target.checked)} /> Share your fear level and vitals (camera estimates)</label>
      <label className="check invite-voice"><input type="checkbox" checked={voice} disabled={!ready || !shareable} onChange={e => onVoice(e.target.checked)}/> Talk with your friend (microphone, optional)</label>
      <p className="invite-note" role="status">{!ready || !shareable ? 'Voice chat needs an online invitation.' : voice ? voiceState.mic === 'denied' ? 'Microphone blocked. Allow it in your browser or system settings, or keep playing without voice.' : voiceState.mic === 'live' ? `Mic on${voiceState.friends ? ` · hearing ${voiceState.friends}` : ' · waiting for your friend to join voice'}. Headphones stop the game sound echoing.` : 'Opening your microphone…' : 'Off. Your friend can still warn you with a button and read you the manual. Turn it on or off any time with MIC at the top right.'}</p>
    </fieldset>
    {cameraWanted && <p className="invite-note" role="status">{camera.status === 'live' ? camera.camera === 'ready' ? `Camera live · ${camera.viewers} watching` : 'Waiting for your camera' : camera.status === 'error' ? 'Camera unavailable. The manual still works.' : 'Connecting your camera…'}</p>}
    <div className="worn-menu"><button className="primary" onClick={onStart}>{starting ? 'Start' : 'Back to the shelter'} →</button><button onClick={onStop}>Stop sharing</button></div>
    </div>
  </section></div>;
}
