import { useEffect, useRef, useState } from 'react';
import { SpectatorCamera, type SpectatorCameraState } from '../integrations/webrtc';
import './camera-share.css';

const TITLE: Record<SpectatorCameraState['status'], string> = { unavailable: 'Unavailable', connecting: 'Connecting', waiting: 'Not shared', joining: 'Connecting', live: 'Live', ended: 'Ended', full: 'Full', error: 'Unavailable' };

/** Spectator view of the player's camera (peer to peer, muted, only while the player shares it), plus
 * optional voice chat on the same link: the friend hears the player and opens their own mic only after
 * pressing Join voice. The player separately chooses whether to talk and hear. */
/** `spotlight` blows the picture up over the page for a moment (a scare); `onLive` reports whether a picture is showing. */
export default function SpectateCamera({ hash, spotlight = false, onLive }: { hash: string; spotlight?: boolean; onLive?: (live: boolean) => void }) {
  const video = useRef<HTMLVideoElement>(null), audio = useRef<HTMLAudioElement>(null), camera = useRef<SpectatorCamera | null>(null), mic = useRef<MediaStream | null>(null);
  const [state, setState] = useState<SpectatorCameraState>({ status: 'connecting', stream: null, message: 'Connecting to the live camera' });
  const [voice, setVoice] = useState<'off' | 'opening' | 'on' | 'denied'>('off'), [videoMuted, setVideoMuted] = useState(true);
  const stopMic = () => { mic.current?.getTracks().forEach(t => t.stop()); mic.current = null; camera.current?.setMic(null); };
  useEffect(() => {
    const current = camera.current = SpectatorCamera.fromWatchHash(hash), off = current.subscribe(setState), leave = () => { stopMic(); current.dispose(); };
    addEventListener('pagehide', leave);
    return () => { removeEventListener('pagehide', leave); off(); stopMic(); current.dispose(); if (camera.current === current) camera.current = null; };
  }, [hash]);
  const live = state.status === 'live' && !!state.stream;
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (el.srcObject !== state.stream) el.srcObject = state.stream;
    if (state.stream) void el.play().catch(() => { /* muted autoplay normally succeeds */ });
    // A voice-only share sends an empty video line: show the camera only once frames actually arrive.
    const track = state.stream?.getVideoTracks()[0];
    setVideoMuted(!track || track.muted);
    if (!track) return;
    const update = () => setVideoMuted(track.muted);
    track.addEventListener('mute', update); track.addEventListener('unmute', update);
    return () => { track.removeEventListener('mute', update); track.removeEventListener('unmute', update); };
  }, [state.stream]);
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    if (el.srcObject !== (state.audio ?? null)) el.srcObject = state.audio ?? null;
    el.muted = voice !== 'on';
    if (state.audio && voice === 'on') void el.play().catch(() => { /* needs the Join voice click */ });
  }, [state.audio, voice]);
  useEffect(() => { if (state.status !== 'live' && voice !== 'off') { stopMic(); setVoice('off'); } }, [state.status, voice]);
  async function joinVoice() {
    if (voice === 'on' || voice === 'opening') { stopMic(); setVoice('off'); return; }
    setVoice('opening');
    try {
      const opened = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      mic.current = opened; camera.current?.setMic(opened.getAudioTracks()[0] ?? null); setVoice('on');
      void audio.current?.play().catch(() => { /* retried when the stream arrives */ });
    } catch { setVoice('denied'); }
  }
  const voiceLine = live && state.voice, picture = live && !videoMuted;
  useEffect(() => { onLive?.(picture); }, [picture, onLive]);
  return <section className={`spectate-card spectate-camera ${state.status}${spotlight && picture ? ' spotlight' : ''}`} aria-label="Player camera and voice">
    <small>PLAYER CAMERA <em>{live && videoMuted ? state.voice ? 'Voice only' : 'No picture yet' : TITLE[state.status]}</em></small>
    <div className="camera-frame">
      <video ref={video} muted playsInline autoPlay hidden={!live || videoMuted} aria-label="Live video from the player's camera"/>
      {live && !videoMuted ? <span className="camera-label"><i aria-hidden="true"/>LIVE · PLAYER CAMERA</span> : <p role="status">{live ? state.voice ? 'Camera off · voice chat available' : 'Waiting for the player’s camera picture' : state.message}</p>}
    </div>
    <audio ref={audio} autoPlay hidden/>
    {voiceLine && <div className="spectate-voice">
      <button className={voice === 'on' ? 'on' : ''} aria-pressed={voice === 'on'} onClick={() => void joinVoice()}>{voice === 'on' ? '● Leave voice' : voice === 'opening' ? 'Opening mic…' : 'Join voice'}</button>
      <span>{voice === 'on' ? 'Your mic is on. They hear you only if they turned voice chat on.' : voice === 'denied' ? 'Microphone blocked. Allow it in your browser settings, or use the warning button.' : 'Optional: talk to the player and hear them. Use headphones.'}</span>
    </div>}
    <span>Peer to peer from the player's device, only while they keep it on. Nothing is recorded or stored.</span>
  </section>;
}
