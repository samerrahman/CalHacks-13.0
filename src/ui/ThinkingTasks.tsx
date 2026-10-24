import type { CSSProperties } from 'react';
import type { GameAction, GameState, Sector } from '../game/state';
import { config } from '../game/config';
import { calmBreath, calmInhale, calmMatched, heartElevated, pulseFlash, pulseRequirement } from '../game/tasks';
import './thinking.css';

const MACHINES = ['COOLANT', 'VENTILATION', 'RELAY', 'TRANSMITTER'];
const SECTORS: [Sector, string, string][] = [['NEAR', 'Near the wall', '0–6 · off camera'], ['A', 'CAM A', 'Clearing · 7–14'], ['B', 'CAM B', 'Service path · 14–22'], ['C', 'CAM C', 'Containment · 22–24']];
type Send = (action: GameAction) => void;

/** Live-data line shared by the Presage-aware tasks. Coarse accepted trend only; no BPM. */
function heartLine(g: GameState, elevated: string, steady: string): string {
  if (g.sensor.source === 'manual' || g.sensor.quality !== 'accepted') return 'No live pulse: the task runs on its standard rules.';
  return heartElevated(g) ? elevated : g.sensor.trend === 'STEADY' || g.sensor.trend === 'RECOVERED' ? steady : 'Live pulse connected; no sustained trend yet.';
}

export function RoutingTask({ g, send }: { g: GameState; send: Send }) {
  const r = g.tasks.routing;
  return <>
    <p>It hears anything louder than <b>{r.limit}</b> at this range. Switch on machines that give at least <b>{r.required}</b> power while their noise adds up to {r.limit} or less. Add it up yourself: switching is silent, engaging is loud, and a wrong engage is louder.</p>
    <div className="routing-grid">{MACHINES.map((label, i) => <button key={label} aria-pressed={r.on[i]} className={r.on[i] ? 'on' : ''} onClick={() => send({ type: 'route', machine: i })}>
      <kbd>{i + 1}</kbd><span>{label}</span><small>POWER <b>{r.power[i]}</b> · NOISE <b>{r.noise[i]}</b></small><em>{r.on[i] ? 'ON' : 'OFF'}</em></button>)}</div>
    <div className="terminal-actions"><button className="transmit" onClick={() => send({ type: 'engage' })}><kbd>T</kbd> Engage relay</button></div>
    <div className="task-progress"><span>Circuit {r.round + 1} / {r.rounds}</span><span>NEED ≥{r.required} POWER · ≤{r.limit} NOISE</span></div>
  </>;
}

export function LocateTerminal({ g }: { g: GameState }) {
  const l = g.tasks.locate;
  return <><p>The emitter needs to know where it is. Go to the security monitor and mark its sector {l.required} times. Use the camera feeds and the range reading. It keeps moving, and wrong marks are loud.</p>
    <div className="task-progress"><span>{l.marks} / {l.required} positions marked</span><span>MONITOR · KEYS 1–4</span></div></>;
}

export function LocatePanel({ g, send }: { g: GameState; send: Send }) {
  const l = g.tasks.locate, wait = Math.max(0, l.lastMarkAt + config.tasks.locate.spacingSeconds - g.time);
  return <div className="locate-panel" data-testid="locate-panel">
    <div className="locate-heading"><span>MARK ITS POSITION · {l.marks} / {l.required}</span><small>{wait > 0 ? `Marker recharging · ${wait.toFixed(1)}s` : 'Check the feeds, then mark'}</small></div>
    <div className="locate-buttons">{SECTORS.map(([sector, label, detail], i) => <button key={sector} disabled={wait > 0} onClick={() => send({ type: 'mark', sector })}><kbd>{i + 1}</kbd><span>{label}</span><small>{detail}</small></button>)}</div>
  </div>;
}

export function PulseTask({ g, send }: { g: GameState; send: Send }) {
  const p = g.tasks.pulse, need = pulseRequirement(g), flash = pulseFlash(g);
  return <>
    <p>It tracks heartbeats. Watch the false pulse and tap <kbd>1</kbd> (or the pad) in its rhythm. {need.beats} beats in a row lock it. There's no number to read; keep the beat.</p>
    <button className="pulse-pad" aria-label="Tap the false heartbeat" onPointerDown={event => { event.preventDefault(); send({ type: 'tap' }); }} onKeyDown={event => { if (event.key === 'Enter') send({ type: 'tap' }); }}
      style={{ '--beat': flash.toFixed(3) } as CSSProperties}><span aria-hidden="true">♥</span></button>
    <div className="task-progress"><span data-testid="pulse-streak">{p.streak} / {need.beats} beats in rhythm</span><span>{heartElevated(g) ? 'TIGHTER TIMING' : 'TAP 1 · PAD'}</span></div>
    <small className="heart-line">{heartLine(g, 'Your own pulse is elevated and bleeding through: more beats, tighter timing.', 'Your pulse is steady; the mask holds at standard timing.')}</small>
  </>;
}

export function CalmTask({ g, send }: { g: GameState; send: Send }) {
  const c = g.tasks.calm, inhale = calmInhale(g), size = calmBreath(g), matched = calmMatched(g);
  const hold = (holding: boolean) => send({ type: 'breathe', holding });
  return <>
    <p>It's listening for you. Hold <kbd>B</kbd> (or press and hold the ring) while it grows to breathe in. Let go while it shrinks. Stay with it until it loses your trail.</p>
    <button className={`calm-ring ${matched ? 'matched' : 'off'}`} aria-label="Hold to breathe in, release to breathe out" aria-pressed={c.holding}
      onPointerDown={event => { event.preventDefault(); hold(true); }} onPointerUp={() => hold(false)} onPointerLeave={() => { if (c.holding) hold(false); }}
      style={{ '--breath': size.toFixed(3) } as CSSProperties}><i/><span>{inhale ? 'BREATHE IN · HOLD' : 'BREATHE OUT · RELEASE'}</span></button>
    <progress aria-label="Calm hold progress" max={c.required} value={c.progress}/>
    <div className="task-progress"><span>{Math.floor(c.progress)} / {c.required} calm seconds</span><span>{matched ? 'IN TIME' : 'OUT OF TIME'}</span></div>
    <small className="heart-line">{heartLine(g, 'Your pulse is elevated: it can still hear you, so progress is slower.', 'Your pulse is steady: progress is faster.')}</small>
  </>;
}
