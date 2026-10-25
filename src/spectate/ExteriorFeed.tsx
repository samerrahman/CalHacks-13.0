import { useEffect, useRef, useState } from 'react';
import type { TraceSnapshot } from '../integrations/client';
import { createExteriorCam, IR_RANGE_M, type ExteriorView } from './exterior';

const compass = (bearing: number) => String(Math.round(((bearing * 180 / Math.PI) % 360 + 360) % 360)).padStart(3, '0');

/** The spectator's outside camera (see exterior.ts). `seconds` is run time carried forward between updates. */
export default function ExteriorFeed({ trace, seconds }: { trace: TraceSnapshot | null; seconds: () => number }) {
  const host = useRef<HTMLDivElement>(null), latest = useRef(trace), clock = useRef(seconds);
  const [view, setView] = useState<ExteriorView | null>(null), [failed, setFailed] = useState(false);
  latest.current = trace; clock.current = seconds;
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let cam: ReturnType<typeof createExteriorCam>;
    try { cam = createExteriorCam(element); } catch { setFailed(true); return; }
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let shown = '', raf = requestAnimationFrame(function frame(t) {
      const next = cam.frame({ trace: latest.current, seconds: clock.current(), nowMs: t, reducedMotion: motion.matches });
      const key = `${Math.round(next.metres)}:${compass(next.bearing)}:${next.visible}:${next.moving}`;
      if (key !== shown) { shown = key; setView(next); }
      raf = requestAnimationFrame(frame);
    });
    return () => { cancelAnimationFrame(raf); cam.dispose(); };
  }, []);
  const s = trace?.summary, lost = s?.status === 'lost', near = !!view && view.visible && view.metres <= 15;
  const label = !s ? 'Waiting for the run' : lost ? 'Signal lost' : s.status === 'won' ? 'Nothing out there now' : view?.visible ? `Motion ${Math.max(0, Math.round(view.metres - 3))} m · bearing ${compass(view.bearing)}°` : `No motion within ${IR_RANGE_M} m`;
  return <div className={`spectate-exterior${failed ? ' failed' : ''}${near ? ' near' : ''}`}>
    <div ref={host} className="spectate-exterior-view" role="img" aria-label={`Outside camera on the shelter roof, drawn on this device from the game state. ${label}.`}/>
    <div className="spectate-cctv-osd" aria-hidden="true">
      <span>CAM 03 · ROOF · IR</span>
      <span>{s && !lost && <>PTZ {view ? compass(view.bearing) : '---'}° · AUTO-TRACK</>}</span>
      <span className={`spectate-exterior-motion${view?.visible ? ' on' : ''}`}>{label}</span>
    </div>
    {failed && <div className="spectate-cctv-lost"><strong>CAMERA UNAVAILABLE</strong><span>This browser could not draw the outside camera.</span></div>}
  </div>;
}
