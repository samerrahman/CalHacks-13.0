import type { CameraShareState } from '../integrations/webrtc';
import './camera-share.css';

/** Always-visible notice while the player's camera is shared live, with an immediate Stop. */
export default function CameraShareBadge({ state, onStop }: { state: CameraShareState; onStop: () => void }) {
  if (state.status !== 'starting' && state.status !== 'live' && state.status !== 'stopping') return null;
  const text = state.status === 'starting' ? 'Starting live camera' : state.status === 'stopping' ? 'Stopping live camera' : `Camera live to spectators · ${state.viewers} watching${state.camera === 'waiting' ? ' · waiting for camera' : ''}`;
  return <div className="camera-share-badge" role="status" aria-live="polite"><i aria-hidden="true"/><span><b>LIVE</b> · {text}</span><button type="button" onClick={onStop} disabled={state.status === 'stopping'}>Stop</button></div>;
}
