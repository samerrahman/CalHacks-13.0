import { useCallback, useEffect, useRef, useState } from 'react';
import { CAMERA_SHARE_OFF, PlayerCameraShare, type CameraShareState, type CameraSignalAccess } from '../integrations/webrtc';

/** The separate live-camera consent. Desktop shares the SensorController stream and never opens a
 * camera; the browser build opens one only after the player ticks the box. Stop it on every new run. */
export function useCameraShare(access: () => CameraSignalAccess | null, stream: MediaStream | null) {
  const share = useRef<PlayerCameraShare | null>(null), latest = useRef<PlayerCameraShare | null>(null);
  const streamRef = useRef(stream), accessRef = useRef(access);
  streamRef.current = stream; accessRef.current = access;
  const [state, setState] = useState<CameraShareState>(CAMERA_SHARE_OFF);
  useEffect(() => { share.current?.refreshTrack(); }, [stream]);
  useEffect(() => () => { share.current?.dispose(); share.current = null; }, []);
  const stop = useCallback(async () => {
    const current = share.current;
    share.current = null;
    if (current) await current.stop(); else setState(CAMERA_SHARE_OFF);
  }, []);
  const setEnabled = useCallback(async (on: boolean) => {
    if (!on) return stop();
    if (share.current) return;
    const target = accessRef.current();
    if (!target) { setState({ ...CAMERA_SHARE_OFF, status: 'error', message: 'Live camera needs trace sharing connected to SpacetimeDB' }); return; }
    const browser = typeof window !== 'undefined' && !window.lockIn && !!navigator.mediaDevices?.getUserMedia;
    const next = new PlayerCameraShare(target, { stream: () => streamRef.current, ...(browser ? { capture: () => navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' }, audio: false }) } : {}) });
    share.current = next; latest.current = next;
    next.subscribe(s => { if (latest.current === next) setState(s); });
    if (!(await next.start()) && share.current === next) share.current = null;
  }, [stop]);
  return { state, enabled: state.status === 'starting' || state.status === 'live', setEnabled, stop };
}
