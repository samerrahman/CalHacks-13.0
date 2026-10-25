import { useEffect, useRef, useState } from 'react';
import type { TraceSnapshot } from '../integrations/client';
import type { PropView } from '../integrations/physics';
import type { Signal } from './feedState';
import { playerActivity, type PlayerView } from './player';
import { createShelterCam, type ShelterCam } from './room';

const pad = (n: number) => String(n).padStart(2, '0');
const AT: Record<PlayerView['station'], string> = { terminal: 'the terminal', cameras: 'the radar screen', equipment: 'the emergency lever' };
const stamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** The spectator's main panel: a fixed camera inside the shelter, drawn on this device from the
 * public game state. It is not the player's webcam. The breach cuts it to static for the run.
 * `propsAt` and `playerAt` must be stable; each is read once per rendered frame. */
export default function CctvFeed({ trace, propsAt, playerAt }: { trace: TraceSnapshot | null; propsAt: (nowMs: number) => readonly PropView[]; playerAt?: (nowMs: number) => PlayerView | null }) {
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
      const next = cam.frame({ trace: latest.current, props: () => propsAt(t), player: playerAt && (() => playerAt(t)), nowMs: t, reducedMotion: motion.matches });
      if (next !== shown) { shown = next; setSignal(next); }
      const now = Date.now();
      if (Math.floor(now / 1000) !== second && clock.current) { second = Math.floor(now / 1000); clock.current.textContent = stamp(new Date(now)); }
      raf = requestAnimationFrame(frame);
    });
    return () => { alive = false; cancelAnimationFrame(raf); cam.dispose(); };
  }, [propsAt, playerAt]);
  const s = trace?.summary, live = signal === 'live' && !failed, at = live && trace && playerAt ? playerActivity(trace) : null;
  const label = `Shelter security camera, drawn on this device from the game state. ${failed ? 'Unavailable on this device.' : signal === 'lost' ? 'Signal lost.' : signal === 'none' ? 'No signal yet.' : `Equipment ${s?.equipment ?? 'on'}.`}${at ? ` The researcher is ${at.working ? 'working' : 'standing'} at ${AT[at.station]}.` : ''}`;
  return <div className={`spectate-cctv ${failed ? 'failed' : signal}`} data-signal={failed ? 'failed' : signal}>
    <div ref={host} className="spectate-cctv-view" role="img" tabIndex={0} aria-label={`${label} Drag or hold arrow keys to look around; release to return.`} />
    <div className="spectate-cctv-osd" aria-hidden="true">
      <span>CAM 02 · SHELTER 04</span>
      <span>{live && <><i className="rec" />REC{s && s.equipment !== 'on' ? ' · LOW LIGHT' : ''}</>}</span>
      <time ref={clock} />
      {live && <span className="spectate-look-hint">DRAG TO LOOK · RELEASE TO RETURN</span>}
    </div>
    {!live && <div className="spectate-cctv-lost" aria-hidden="true">
      <strong>{failed ? 'CAMERA UNAVAILABLE' : signal === 'lost' ? 'SIGNAL LOST' : 'NO SIGNAL'}</strong>
      <span>{failed ? 'This browser could not draw the shelter. Events and the map still update.' : signal === 'lost' ? 'CAM 02 · feed cut' : 'Waiting for the player’s run'}</span>
    </div>}
    <p className="spectate-sr" aria-live="polite">{signal === 'lost' ? 'The shelter camera lost its signal.' : ''}</p>
  </div>;
}
