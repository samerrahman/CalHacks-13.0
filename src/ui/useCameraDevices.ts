import { useEffect, useState } from 'react';

/** Video inputs for a camera picker. Labels only appear once the browser has granted camera access,
 * so the list refreshes when a stream starts and whenever devices change. */
export function useCameraDevices(stream: MediaStream | null): MediaDeviceInfo[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const refresh = () => { void navigator.mediaDevices?.enumerateDevices().then(list => setDevices(list.filter(d => d.kind === 'videoinput'))).catch(() => setDevices([])); };
    refresh();
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refresh);
  }, [stream]);
  return devices;
}
