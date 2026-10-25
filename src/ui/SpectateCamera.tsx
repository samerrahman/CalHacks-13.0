import { useEffect, useRef, useState } from 'react';
import { SpectatorCamera, type SpectatorCameraState } from '../integrations/webrtc';
import './camera-share.css';

const TITLE: Record<SpectatorCameraState['status'], string> = { unavailable: 'Unavailable', connecting: 'Connecting', waiting: 'Not shared', joining: 'Connecting', live: 'Live', ended: 'Ended', full: 'Full', error: 'Unavailable' };

/** Spectator view of the player's camera: peer to peer, muted, only while the player shares it. */
export default function SpectateCamera({ hash }: { hash: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<SpectatorCameraState>({ status: 'connecting', stream: null, message: 'Connecting to the live camera' });
  useEffect(() => {
    const camera = SpectatorCamera.fromWatchHash(hash), off = camera.subscribe(setState), leave = () => camera.dispose();
    addEventListener('pagehide', leave);
    return () => { removeEventListener('pagehide', leave); off(); camera.dispose(); };
  }, [hash]);
  const live = state.status === 'live' && !!state.stream;
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (el.srcObject !== state.stream) el.srcObject = state.stream;
    if (state.stream) void el.play().catch(() => { /* muted autoplay normally succeeds */ });
  }, [state.stream]);
  return <section className={`spectate-card spectate-camera ${state.status}`} aria-label="Player camera">
    <small>PLAYER CAMERA <em>{TITLE[state.status]}</em></small>
    <div className="camera-frame">
      <video ref={video} muted playsInline autoPlay hidden={!live} aria-label="Live video from the player's camera"/>
      {live ? <span className="camera-label"><i aria-hidden="true"/>LIVE · PLAYER CAMERA</span> : <p role="status">{state.message}</p>}
    </div>
    <span>Peer to peer from the player's device, only while they keep it on. Nothing is recorded or stored.</span>
  </section>;
}
