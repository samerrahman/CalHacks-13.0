import { useCallback, useEffect, useRef, useState } from 'react';
import { CAMERA_SHARE_OFF, PlayerCameraShare, type CameraShareState, type CameraSignalAccess } from '../integrations/webrtc';

/** The separate live-camera consent, plus optional voice chat with spectating friends. Desktop shares the
 * SensorController stream and never opens a camera; the browser build opens one only after consent. A
 * voice-only share opens no camera at all. The microphone opens only while voice is on and a share is
 * running, and friends are heard only while voice is on. Stop it on every new run. */
export function useCameraShare(access: () => CameraSignalAccess | null, stream: MediaStream | null) {
  const share = useRef<PlayerCameraShare | null>(null), latest = useRef<PlayerCameraShare | null>(null);
  const streamRef = useRef(stream), accessRef = useRef(access);
  streamRef.current = stream; accessRef.current = access;
  const [state, setState] = useState<CameraShareState>(CAMERA_SHARE_OFF);
  const mic = useRef<MediaStream | null>(null), wantVoice = useRef(false), friends = useRef(new Map<string, HTMLAudioElement>());
  const [voice, setVoiceState] = useState<{ on: boolean; mic: 'off' | 'opening' | 'live' | 'denied'; friends: number }>({ on: false, mic: 'off', friends: 0 });
  const publishVoice = useCallback((patch: Partial<typeof voice>) => setVoiceState(v => ({ ...v, ...patch, friends: friends.current.size })), []);

  const releaseMic = useCallback(() => {
    mic.current?.getTracks().forEach(t => { try { t.stop(); } catch { /* already stopped */ } });
    mic.current = null; share.current?.refreshMic();
  }, []);
  const clearFriends = useCallback(() => {
    for (const el of friends.current.values()) { el.pause(); el.srcObject = null; }
    friends.current.clear();
  }, []);
  const ensureMic = useCallback(async () => {
    if (!wantVoice.current || !share.current || mic.current || !navigator.mediaDevices?.getUserMedia) return;
    publishVoice({ mic: 'opening' });
    try {
      const opened = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (!wantVoice.current || !share.current) { opened.getTracks().forEach(t => t.stop()); publishVoice({ mic: 'off' }); return; }
      mic.current = opened; share.current.refreshMic(); publishVoice({ mic: 'live' });
    } catch { publishVoice({ mic: 'denied' }); }
  }, [publishVoice]);
  const onFriendAudio = useCallback((key: string, remote: MediaStream | null) => {
    const existing = friends.current.get(key);
    if (!remote) { if (existing) { existing.pause(); existing.srcObject = null; friends.current.delete(key); } publishVoice({}); return; }
    const el = existing ?? new Audio();
    el.srcObject = remote; el.muted = !wantVoice.current; el.autoplay = true;
    friends.current.set(key, el); void el.play().catch(() => { /* resumes on the next user gesture */ });
    publishVoice({});
  }, [publishVoice]);

  useEffect(() => { share.current?.refreshTrack(); }, [stream]);
  useEffect(() => () => { share.current?.dispose(); share.current = null; releaseMic(); clearFriends(); }, [releaseMic, clearFriends]);
  const stop = useCallback(async () => {
    const current = share.current;
    share.current = null;
    releaseMic(); clearFriends(); publishVoice({ mic: 'off' });
    if (current) await current.stop(); else setState(CAMERA_SHARE_OFF);
  }, [releaseMic, clearFriends, publishVoice]);
  /** Starts the share. `video: false` is voice only: no camera opens and the video line stays empty. */
  const setEnabled = useCallback(async (on: boolean, options: { video?: boolean } = {}) => {
    if (!on) return stop();
    if (share.current) return;
    const target = accessRef.current();
    if (!target) { setState({ ...CAMERA_SHARE_OFF, status: 'error', message: 'Live camera needs trace sharing connected to SpacetimeDB' }); return; }
    const video = options.video !== false;
    const browser = typeof window !== 'undefined' && !window.lockIn && !!navigator.mediaDevices?.getUserMedia;
    const next = new PlayerCameraShare(target, {
      stream: () => video ? streamRef.current : null, video,
      ...(browser && video ? { capture: () => navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' }, audio: false }) } : {}),
      voice: { mic: () => mic.current?.getAudioTracks().find(t => t.readyState === 'live') ?? null, onFriendAudio },
    });
    share.current = next; latest.current = next;
    next.subscribe(s => { if (latest.current === next) setState(s); });
    if (!(await next.start()) && share.current === next) { share.current = null; return; }
    void ensureMic();
  }, [stop, ensureMic, onFriendAudio]);
  /** Voice chat on: open the mic (while a share runs) and hear friends. Off: close the mic and mute them. */
  const setVoice = useCallback(async (on: boolean) => {
    wantVoice.current = on;
    for (const el of friends.current.values()) { el.muted = !on; if (on) void el.play().catch(() => { /* retried on next gesture */ }); }
    publishVoice({ on });
    if (on) await ensureMic(); else { releaseMic(); publishVoice({ mic: 'off' }); }
  }, [ensureMic, releaseMic, publishVoice]);
  return { state, enabled: state.status === 'starting' || state.status === 'live', setEnabled, stop, voice, setVoice };
}
