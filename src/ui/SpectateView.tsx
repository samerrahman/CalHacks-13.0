import { useEffect, useRef, useState } from 'react';
import { SpectateFeed, type SpectateState, type SpectatorVitals } from '../integrations/spectate';
import type { PropView } from '../integrations/physics';
import { DOOR, OBSTACLES, ROOM } from '../../spacetimedb/src/physicsSim';
import './spectate.css';

const HELD_MS = 5000, GONE_MS = 15000;
const TREND: Record<SpectatorVitals['trend'], string> = { UNKNOWN: 'No sustained change yet', STEADY: 'Holding steady', ELEVATED: 'Up and staying up', RECOVERED: 'Coming back down' };
const MOMENTS: Record<string, (detail: string) => string> = {
  RUN_STARTED: () => 'The run started', PROXIMITY_ALARM: () => 'It reached the wall', SCARE: d => d === 'breach' ? 'It broke through' : 'Something hit the door',
  ATTACK_COMMITTED: () => 'It is coming through', WRONG_INPUT: d => `A mistake (${d.toLowerCase() || 'input'})`, TASK_COMPLETE: d => `Stage ${d} complete`,
  LURE_TRANSMITTED: d => `Lure sent to ${d.replace('_', ' ').toLowerCase()}`, QUIET_ENTERED: () => 'Equipment isolated', RESTORED: () => 'Power restored',
  BLACKOUT_STARTED: () => 'Blackout', FINAL_BROADCAST: () => 'Final broadcast', WON: () => 'Contained', LOST: () => 'Lost', TIMEOUT: () => 'Out of time', PAUSED: () => 'Paused', RESUMED: () => 'Resumed',
};
const PROP_COLOUR: Record<string, string> = { can: '#a9b28a', mug: '#d1b98a', bolt: '#8d9188', bottle: '#7f9f8f', flashlight: '#d49a5e' };

function drawShelter(canvas: HTMLCanvasElement | null, props: PropView[]): void {
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  const ratio = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) { canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio); }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, w, h);
  const spanX = ROOM.max[0] - ROOM.min[0], spanZ = ROOM.max[2] - ROOM.min[2], scale = Math.min((w - 24) / spanX, (h - 24) / spanZ);
  const ox = (w - spanX * scale) / 2, oz = (h - spanZ * scale) / 2;
  const px = (x: number) => ox + (x - ROOM.min[0]) * scale, pz = (z: number) => oz + (z - ROOM.min[2]) * scale;
  ctx.fillStyle = '#0d1410'; ctx.strokeStyle = '#5d6a52'; ctx.lineWidth = 2;
  ctx.fillRect(px(ROOM.min[0]), pz(ROOM.min[2]), spanX * scale, spanZ * scale); ctx.strokeRect(px(ROOM.min[0]), pz(ROOM.min[2]), spanX * scale, spanZ * scale);
  ctx.fillStyle = '#1c2219'; ctx.strokeStyle = '#3b4434'; ctx.lineWidth = 1;
  for (const box of OBSTACLES) { ctx.fillRect(px(box.min[0]), pz(box.min[2]), (box.max[0] - box.min[0]) * scale, (box.max[2] - box.min[2]) * scale); ctx.strokeRect(px(box.min[0]), pz(box.min[2]), (box.max[0] - box.min[0]) * scale, (box.max[2] - box.min[2]) * scale); }
  ctx.strokeStyle = '#9a5a36'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(px(DOOR[0] - 0.5), pz(ROOM.max[2])); ctx.lineTo(px(DOOR[0] + 0.5), pz(ROOM.max[2])); ctx.stroke();
  ctx.fillStyle = '#7b7a68'; ctx.font = '9px "Courier New", monospace';
  ctx.fillText('DESK', px(-0.4), pz(-1.85)); ctx.fillText('RACK', px(2.18), pz(0.05)); ctx.fillText('SEALED DOOR', px(DOOR[0] - 0.42), pz(ROOM.max[2]) - 7);
  for (const p of props) {
    // Height reads as a bigger body with a shadow left behind on the floor.
    const r = Math.max(2.5, p.radius * scale * (1 + p.y * 0.55)), x = px(p.x), z = pz(p.z), lift = Math.min(10, p.y * 6);
    ctx.fillStyle = '#0008'; ctx.beginPath(); ctx.arc(x + lift * 0.4, z + lift, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PROP_COLOUR[p.kind] ?? '#999'; ctx.globalAlpha = p.sleeping ? 0.75 : 1;
    ctx.beginPath(); ctx.arc(x, z, r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  }
}

function Vitals({ vitals, age }: { vitals: SpectatorVitals | null; age: number | null }) {
  if (!vitals || age === null || age > GONE_MS) return <section className="spectate-card spectate-vitals off"><small>HEART RATE</small><strong>—</strong><span>{vitals ? 'No recent reading from the player.' : 'No heart rate is being shared right now. You can still follow the run.'}</span></section>;
  const held = age > HELD_MS, bpm = vitals.pulseBpm, delta = bpm !== null && vitals.baselineBpm !== null ? bpm - vitals.baselineBpm : null;
  const note = bpm !== null ? TREND[vitals.trend] : vitals.quality === 'rejected' ? 'Reading rejected (movement or lighting)' : vitals.status === 'calibrating' || vitals.status === 'starting' ? 'Calibrating the camera' : vitals.status === 'paused' ? 'Capture paused' : 'No accepted reading right now';
  return <section className={`spectate-card spectate-vitals${held ? ' held' : ''}${vitals.trend === 'ELEVATED' ? ' elevated' : ''}`}>
    <small>HEART RATE <em className={vitals.source}>{vitals.source === 'simulated' ? 'SIMULATED · not a real heart rate' : 'PRESAGE · camera estimate'}</em></small>
    <strong><i className="beat" style={bpm ? { animationDuration: `${(60 / bpm).toFixed(2)}s` } : undefined} aria-hidden="true">♥</i>{bpm ?? '—'}<span>BPM</span></strong>
    <span>{delta !== null && <b>{delta > 0 ? '+' : ''}{delta} vs their baseline · </b>}{note}{held && ` · held, no update for ${Math.floor(age / 1000)} s`}</span>
  </section>;
}

export default function SpectateView() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<SpectateState | null>(null), [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const feed = new SpectateFeed(location.hash), off = feed.subscribe(setState), clock = setInterval(() => setNow(performance.now()), 500);
    let raf = requestAnimationFrame(function frame(t) { drawShelter(canvas.current, feed.props(t)); raf = requestAnimationFrame(frame); });
    return () => { off(); clearInterval(clock); cancelAnimationFrame(raf); feed.dispose(); };
  }, []);
  const trace = state?.trace, s = trace?.summary, traceAge = state?.traceReceivedAt == null ? null : now - state.traceReceivedAt;
  const moments = (trace?.events ?? []).filter(e => MOMENTS[e.type]).slice(-6).reverse();
  return <main className="judge-page spectate-page">
    <div className="eyebrow">HUSH / SPECTATING · READ ONLY</div>
    <h1>You're watching.</h1>
    <p className="small muted">{state?.status ?? 'Connecting'}{traceAge !== null && traceAge > HELD_MS && ` · no update for ${Math.floor(traceAge / 1000)} s`}</p>
    <div className="spectate-grid">
      <Vitals vitals={state?.vitals ?? null} age={state?.vitalsReceivedAt == null ? null : now - state.vitalsReceivedAt} />
      {s ? <section className="spectate-card">
        <small>THE RUN</small>
        <strong>{s.status === 'won' ? 'Contained' : s.status === 'lost' ? 'Lost' : s.stage >= 5 ? 'Final containment' : `Stage ${s.stage} of 4`}</strong>
        <span>{Math.floor(s.time / 60)}:{String(Math.floor(s.time % 60)).padStart(2, '0')} · equipment {s.equipment} · {'●'.repeat(s.quietChargesRemaining)}{'○'.repeat(Math.max(0, 3 - s.quietChargesRemaining))} isolation</span>
        <label className="spectate-meter"><span>Creature · {s.linePosition} of {s.lineLength} from the wall · {s.creaturePhase}</span><meter min={0} max={s.lineLength} low={7} high={10} optimum={s.lineLength} value={s.linePosition} /></label>
        <label className="spectate-meter"><span>Exposure · {s.danger}%</span><meter min={0} max={100} low={40} high={70} optimum={0} value={s.danger} /></label>
      </section> : <section className="spectate-card off"><small>THE RUN</small><strong>Waiting</strong><span>Keep this page open. It updates when the player is in a run with sharing on.</span></section>}
    </div>
    <div className="spectate-grid">
      <section className="spectate-card spectate-room">
        <small>THE SHELTER <em>{state?.physics === 'spacetime' ? 'PROPS · SPACETIMEDB PHYSICS' : 'PROPS · LOCAL REPLAY (OFFLINE)'}</em></small>
        <canvas ref={canvas} role="img" aria-label="Top-down view of the shelter. Loose props move when the creature hits the door." />
      </section>
      <section className="spectate-card">
        <small>MOMENTS</small>
        <ol className="spectate-moments">{moments.length ? moments.map(e => <li key={e.id}><time>{Math.floor(e.time / 60)}:{String(Math.floor(e.time % 60)).padStart(2, '0')}</time>{MOMENTS[e.type]!(e.detail)}</li>) : <li>Nothing yet.</li>}</ol>
      </section>
    </div>
    <p className="small muted spectate-privacy">You see game events, the creature's distance and, only if the player turned it on, their current heart rate. No camera image, recording or puzzle answer is shared, and you cannot affect the game. A camera pulse estimate is a game input, not a medical reading.</p>
  </main>;
}
