import { useEffect, useRef, useState } from 'react';
import type { TraceSnapshot } from '../integrations/client';
import type { PropView } from '../integrations/physics';
import type { Signal } from './feedState';
import { createShelterCam, type ShelterCam } from './room';

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** The spectator's main panel: a fixed camera inside the shelter, drawn on this device from the
 * public game state. It is not the player's webcam. The breach cuts it to static for the run.
 * `propsAt` must be stable; it is read once per rendered frame. */
export default function CctvFeed({ trace, propsAt }: { trace: TraceSnapshot | null; propsAt: (nowMs: number) => readonly PropView[] }) {
  const host = useRef<HTMLDivElement>(null), clock = useRef<HTMLTimeElement>(null), latest = useRef(trace);
  const [signal, setSignal] = useState<Signal>('none'), [failed, setFailed] = useState(false);
  useEffect(() => { latest.current = trace; }, [trace]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let cam: ShelterCam;
    try { cam = createShelterCam(element); } catch { setFailed(true); return; }
    let alive = true, shown: Signal = 'none', second = -1;
    cam.ready.catch(() => { if (alive) setFailed(true); });
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let raf = requestAnimationFrame(function frame(t) {
      const next = cam.frame({ trace: latest.current, props: () => propsAt(t), nowMs: t, reducedMotion: motion.matches });
      if (next !== shown) { shown = next; setSignal(next); }
      const now = Date.now();
      if (Math.floor(now / 1000) !== second && clock.current) { second = Math.floor(now / 1000); clock.current.textContent = stamp(new Date(now)); }
      raf = requestAnimationFrame(frame);
    });
    return () => { alive = false; cancelAnimationFrame(raf); cam.dispose(); };
  }, [propsAt]);
  const s = trace?.summary, live = signal === 'live' && !failed;
  const label = `Shelter security camera, drawn on this device from the game state. ${failed ? 'Unavailable on this device.' : signal === 'lost' ? 'Signal lost.' : signal === 'none' ? 'No signal yet.' : `Equipment ${s?.equipment ?? 'on'}.`}`;
  return <div className={`spectate-cctv ${failed ? 'failed' : signal}`} data-signal={failed ? 'failed' : signal}>
    <div ref={host} className="spectate-cctv-view" role="img" aria-label={label} />
    <div className="spectate-cctv-osd" aria-hidden="true">
      <span>CAM 02 · SHELTER 04</span>
      <span>{live && <><i className="rec" />REC{s && s.equipment !== 'on' ? ' · LOW LIGHT' : ''}</>}</span>
      <time ref={clock} />
    </div>
    {!live && <div className="spectate-cctv-lost" aria-hidden="true">
      <strong>{failed ? 'CAMERA UNAVAILABLE' : signal === 'lost' ? 'SIGNAL LOST' : 'NO SIGNAL'}</strong>
      <span>{failed ? 'This browser could not draw the shelter. Events and the map still update.' : signal === 'lost' ? 'CAM 02 · feed cut' : 'Waiting for the player’s run'}</span>
    </div>}
    <p className="spectate-sr" aria-live="polite">{signal === 'lost' ? 'The shelter camera lost its signal.' : ''}</p>
  </div>;
}
