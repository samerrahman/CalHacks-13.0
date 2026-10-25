import { useCallback, useEffect, useRef, useState } from 'react';
import { SpectateFeed, type SpectateState, type SpectatorVitals } from '../integrations/spectate';
import type { TraceSnapshot } from '../integrations/client';
import CctvFeed from '../spectate/CctvFeed';
import { PlayerWalker, type PlayerView } from '../spectate/player';
import { creatureDistance, METRES_PER_UNIT } from '../spectate/distance';
import type { PropView } from '../integrations/physics';
import { DOOR, OBSTACLES, ROOM } from '../../spacetimedb/src/physicsSim';
import './spectate.css';
import CoopManual from './CoopManual';
import FriendControls from '../spectate/FriendControls';
import { CoopManualFeed } from '../integrations/coop';
import { Heartbeat, WornTitle } from './Worn';
import './spectate-worn.css';
import SpectateCamera from './SpectateCamera';
import { readSpectatorFear, spectatorFearMemory } from './vitalsHold';

const HELD_MS = 5000, GONE_MS = 15000;
const TREND: Record<SpectatorVitals['trend'], string> = { UNKNOWN: 'No sustained change yet', STEADY: 'Holding steady', ELEVATED: 'Up and staying up', RECOVERED: 'Coming back down' };
const MOMENTS: Record<string, (detail: string) => string> = {
  RUN_STARTED: () => 'The run started', PROXIMITY_ALARM: () => 'It reached the wall', SCARE: d => d === 'breach' ? 'It broke through' : 'Something hit the door',
  ATTACK_COMMITTED: () => 'It is coming through', WRONG_INPUT: d => `A mistake (${d.toLowerCase() || 'input'})`, TASK_COMPLETE: d => `Stage ${d} complete`,
  LURE_TRANSMITTED: d => `Lure sent to ${d.replace('_', ' ').toLowerCase()}`, QUIET_ENTERED: () => 'Equipment isolated', RESTORED: () => 'Power restored',
  BLACKOUT_STARTED: () => 'Blackout', FRIEND_WARNING: () => 'You warned them', FRIEND_DECOY: () => 'Your decoy fired', DOOR_UNLOCKED: () => 'Your door key turned', RECOVERY_REWARD: () => 'They steadied · it lost their trail', FINAL_BROADCAST: () => 'Final broadcast', WON: () => 'Contained', LOST: () => 'Lost', TIMEOUT: () => 'Out of time', PAUSED: () => 'Paused', RESUMED: () => 'Resumed',
};
const PROP_COLOUR: Record<string, string> = { can: '#a9b28a', mug: '#d1b98a', bolt: '#8d9188', bottle: '#7f9f8f', flashlight: '#d49a5e' };

function drawShelter(canvas: HTMLCanvasElement | null, props: PropView[], player: PlayerView | null): void {
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
  if (player) {
    // The player's researcher, the same figure the shelter camera shows: a dot facing their way.
    const x = px(player.x), z = pz(player.z), r = Math.max(4, .17 * scale);
    ctx.strokeStyle = '#e6dfc0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, z); ctx.lineTo(x + Math.sin(player.heading) * r * 2, z + Math.cos(player.heading) * r * 2); ctx.stroke();
    ctx.fillStyle = '#e6dfc0'; ctx.beginPath(); ctx.arc(x, z, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7b7a68'; ctx.fillText('PLAYER', x + r + 4, z - r);
  }
}

/** One FEAR reading for the spectator in place of separate heart-rate and breathing numbers: the
 * player's device combines its camera estimates (face, heart rate, breathing, skin response) into
 * one percentage, held through dropouts; an older player build only lets it be estimated from heart
 * rate (vitalsHold.ts). */
function Fear({ vitals, age, now }: { vitals: SpectatorVitals | null; age: number | null; now: number }) {
  const memory = useRef(spectatorFearMemory());
  if (!vitals || age === null || age > GONE_MS) {
    // Not shared (or gone): forget the last reading, so a re-enabled share never resurfaces it.
    memory.current = spectatorFearMemory();
    return <section className="spectate-card spectate-vitals spectate-fear off"><small>FEAR</small><strong>—</strong><span>{vitals ? 'No recent reading' : 'Not shared'}</span></section>;
  }
  const fear = readSpectatorFear(memory.current, vitals, now), held = age > HELD_MS || fear.fearPct !== null && !fear.live;
  const status = vitals.status === 'calibrating' || vitals.status === 'starting' ? 'Calibrating their camera' : vitals.status === 'paused' ? 'Capture paused' : vitals.quality === 'rejected' ? 'Reading rejected (movement or lighting)' : 'Waiting for a reading';
  const note = fear.fearPct === null ? status : fear.live ? TREND[fear.trend] : `${status} · showing their last reading`;
  return <section className={`spectate-card spectate-vitals spectate-fear mood-${fear.label.toLowerCase()}${held ? ' held' : ''}`}>
    <small>FEAR <em className={vitals.source}>{vitals.source === 'simulated' ? 'SIMULATED' : fear.basis === 'heart rate' ? 'FROM THEIR HEART RATE' : 'FROM THEIR CAMERA'}</em></small>
    <strong>{fear.fearPct === null ? '—' : `${fear.fearPct}%`}<span>{fear.label}</span></strong>
    <div className="spectate-meter"><meter aria-label="Fear level" min={0} max={100} low={25} high={50} optimum={0} value={fear.fearPct ?? 0} /></div>
    <span>{note}{age > HELD_MS && ` · held, no update for ${Math.floor(age / 1000)} s`}</span>
  </section>;
}

export default function SpectateView() {
  const canvas = useRef<HTMLCanvasElement>(null), feed = useRef<SpectateFeed | null>(null);
  const [state, setState] = useState<SpectateState | null>(null), [now, setNow] = useState(() => performance.now());
  const propsAt = useCallback((t: number) => feed.current?.props(t) ?? [], []);
  // One walker for the camera and the map, so both show the researcher in the same place.
  const [walker] = useState(() => new PlayerWalker()), [motion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)')), latestTrace = useRef<TraceSnapshot | null>(null);
  const playerAt = useCallback((t: number) => walker.at(latestTrace.current, t, motion.matches), [walker, motion]);
  useEffect(() => {
    const current = feed.current = new SpectateFeed(location.hash), off = current.subscribe(next => { latestTrace.current = next.trace; setState(next); }), clock = setInterval(() => setNow(performance.now()), 500);
    let raf = requestAnimationFrame(function frame(t) { drawShelter(canvas.current, current.props(t), playerAt(t)); raf = requestAnimationFrame(frame); });
    return () => { off(); clearInterval(clock); cancelAnimationFrame(raf); current.dispose(); if (feed.current === current) feed.current = null; };
  }, []);
  const coop = state?.trace?.mode === 'coop', [coopFeed, setCoopFeed] = useState<CoopManualFeed | null>(null);
  // One manual feed per page in co-op: it reads the manual and carries the friend's warning and decoys.
  useEffect(() => { if (!coop) return; const next = new CoopManualFeed(location.hash); setCoopFeed(next); return () => { next.dispose(); setCoopFeed(null); }; }, [coop]);
  const trace = state?.trace, s = trace?.summary, traceAge = state?.traceReceivedAt == null ? null : now - state.traceReceivedAt;
  const moments = (trace?.events ?? []).filter(e => MOMENTS[e.type]).slice(-4).reverse();
  // Run time carried forward between updates (at most 2 s) so the distance keeps drifting smoothly.
  const distance = s ? creatureDistance(s.linePosition, s.time + (s.status === 'playing' && traceAge !== null ? Math.min(2, traceAge / 1000) : 0), trace!.seed) : null;
  return <main className="judge-page spectate-page">
    <div className="spectate-backdrop" aria-hidden="true"/>
    <header className="spectate-head"><WornTitle text={trace?.mode==='coop'?'LIFELINE':'WATCHING'}/><Heartbeat/>
      <p className="spectate-status">{state?.status ?? 'Connecting'}{traceAge !== null && traceAge > HELD_MS && ` · no update for ${Math.floor(traceAge / 1000)} s`}</p></header>
    <div className="spectate-columns">
    {/* The footage stays pinned on the left; everything to read scrolls on the right. */}
    <div className="spectate-scroll">
    {coop&&coopFeed&&<CoopManual hash={location.hash} feed={coopFeed}/>}
    {coop&&coopFeed&&<FriendControls feed={coopFeed} trace={trace ?? null}/>}
    <div className="spectate-side">
        <Fear vitals={state?.vitals ?? null} age={state?.vitalsReceivedAt == null ? null : now - state.vitalsReceivedAt} now={now} />
        {s && distance ? <section className="spectate-card">
          <small>THE RUN</small>
          <strong>{s.status === 'won' ? 'Contained' : s.status === 'lost' ? 'Lost' : s.stage >= 5 ? 'Final containment' : `Stage ${s.stage} of 4`}</strong>
          <span>{Math.floor(s.time / 60)}:{String(Math.floor(s.time % 60)).padStart(2, '0')} · power {s.equipment} · {'●'.repeat(s.quietChargesRemaining)}{'○'.repeat(Math.max(0, 3 - s.quietChargesRemaining))}</span>
          <label className="spectate-meter"><span>Creature · {distance.atWall ? distance.label : `${distance.label} from the wall`}</span><meter min={0} max={s.lineLength * METRES_PER_UNIT} low={7 * METRES_PER_UNIT} high={10 * METRES_PER_UNIT} optimum={s.lineLength * METRES_PER_UNIT} value={distance.metres} /></label>
          <label className="spectate-meter"><span>Exposure · {s.danger}%</span><meter min={0} max={100} low={40} high={70} optimum={0} value={s.danger} /></label>
        </section> : <section className="spectate-card off"><small>THE RUN</small><strong>Waiting</strong><span>Keep this page open.</span></section>}
    </div>
    <div className="spectate-grid">
      <section className="spectate-card spectate-room">
        <small>MAP</small>
        <canvas ref={canvas} role="img" aria-label="Top-down map of the shelter. The light dot is the player. Loose props move when the creature hits the door." />
      </section>
      <section className="spectate-card">
        <small>MOMENTS</small>
        <ol className="spectate-moments">{moments.length ? moments.map(e => <li key={e.id}><time>{Math.floor(e.time / 60)}:{String(Math.floor(e.time % 60)).padStart(2, '0')}</time>{MOMENTS[e.type]!(e.detail)}</li>) : <li>Nothing yet.</li>}</ol>
      </section>
    </div>
    </div>
    <aside className="spectate-footage" aria-label="Footage">
      <section className="spectate-card spectate-cctv-card" aria-label="Shelter camera">
        <small>SHELTER CAMERA</small>
        <CctvFeed trace={trace ?? null} propsAt={propsAt} playerAt={playerAt} />
      </section>
      <SpectateCamera hash={location.hash}/>
    </aside>
    </div>
    <p className="spectate-privacy">Nothing is recorded · fear is a camera estimate from their face, breathing and heart rate, not a medical reading{coop ? " · their game checks every warning and decoy" : ""}.</p>
  </main>;
}
