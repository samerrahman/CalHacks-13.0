import { useEffect, type CSSProperties } from 'react';
import type { GameAction, GameState, Sector } from '../game/state';
import { config } from '../game/config';
import { calmBreath, calmInhale, calmMatched, conduitConnected, energizedTiles, FAULT_SOUNDS, faultSounds, heartElevated, listeningTo, pulseFlash, pulseRequirement, tileOpenings } from '../game/tasks';
import './thinking.css';

// Sonar rings on the radar scope, innermost first; keys 1–4 mark the same rings.
const SECTORS: [Sector, string, string][] = [['NEAR', 'Ring 1', 'Near the wall'], ['A', 'Ring 2', 'Clearing'], ['B', 'Ring 3', 'Service path'], ['C', 'Ring 4', 'Far out']];
type Send = (action: GameAction) => void;

/** Live-data line shared by the Presage-aware tasks. Coarse accepted trend only; no BPM. */
function heartLine(g: GameState, elevated: string, steady: string): string {
  if (g.sensor.source === 'manual' || g.sensor.quality !== 'accepted') return 'No live pulse: the task runs on its standard rules.';
  return heartElevated(g) ? elevated : g.sensor.trend === 'STEADY' || g.sensor.trend === 'RECOVERED' ? steady : 'Live pulse connected; no sustained trend yet.';
}

const PIPE: [number, string][] = [[1, 'M20 20V0'], [2, 'M20 20H40'], [4, 'M20 20V40'], [8, 'M20 20H0']];
/** Co-op hides the power glow and the joined reading: the friend's manual has the solved route. */
export function ConduitTask({ g, send, coop = g.mode === 'coop' }: { g: GameState; send: Send; coop?: boolean }) {
  const r = g.tasks.routing, lit = coop ? new Set<number>() : energizedTiles(r), joined = !coop && conduitConnected(r);
  return <>
    <p>{coop ? 'The relay conduit is broken and its power reading is dead. Your friend\'s manual shows the solved route: describe a tile by row and column, rotate it as they say, then press T. Rotating is quiet; engaging a broken conduit arcs loudly.' : 'The relay conduit is broken. Click tiles to rotate them until the inlet on the left joins the outlet on the right, then press T. Rotating is quiet; engaging a broken conduit arcs loudly. Powered pipe glows.'}</p>
    <div className="conduit" style={{ gridTemplateColumns: `14px repeat(${r.size}, 1fr) 14px` }}>
      {Array.from({ length: r.size }, (_, row) => <div key={row} className="conduit-row">
        <i className={row === r.start ? 'conduit-port in' : 'conduit-port'} aria-hidden="true"/>
        {Array.from({ length: r.size }, (_, col) => { const tile = row * r.size + col, open = tileOpenings(r.kinds[tile]!, r.turns[tile]!);
          return <button key={tile} className={`conduit-tile ${lit.has(tile) ? 'lit' : ''}`} title={coop ? `Row ${row + 1}, column ${col + 1}` : undefined} aria-label={`Conduit tile row ${row + 1} column ${col + 1}${lit.has(tile) ? ', powered' : ''}`} onClick={() => send({ type: 'rotate', tile })}>
            <svg viewBox="0 0 40 40" aria-hidden="true">{PIPE.filter(([bit]) => open & bit).map(([bit, d]) => <path key={bit} d={d}/>)}{open ? <circle cx="20" cy="20" r="4.5"/> : null}</svg></button>; })}
        <i className={row === r.end ? `conduit-port out ${joined ? 'joined' : ''}` : 'conduit-port'} aria-hidden="true"/>
      </div>)}
    </div>
    <div className="terminal-actions"><button className="transmit" onClick={() => send({ type: 'engage' })}><kbd>T</kbd> Engage relay</button></div>
    <div className="task-progress"><span>Conduit {r.round + 1} / {r.rounds}</span><span>{coop ? 'NO POWER READING · ASK THE MANUAL' : joined ? 'CONNECTED · PRESS T' : 'NOT CONNECTED'}</span></div>
  </>;
}

/** Faults are found by ear: plain numbered buttons, the rack's sound key while it plays, and a caption of what is audible.
 * In co-op the key never plays (listeningTo is null) and the friend's manual maps each sound to its machine. */
export function FaultTask({ g, send, coop = g.mode === 'coop' }: { g: GameState; send: Send; coop?: boolean }) {
  const f = g.tasks.faults, sounds = faultSounds(g), playing = coop ? null : listeningTo(g);
  const heard = f.active.map(machine => FAULT_SOUNDS[sounds[machine]!]);
  useEffect(() => {
    if (!coop && playing === null && f.completed === 0) send({ type: 'listen' });
  }, [coop, g.tasks.stage]);
  return <>
    <p>{coop ? `Tell your friend what you hear; their manual says which machine makes that sound. Up to ${f.maximumActive} can fail at once. Wrong guesses clang loudly.` : playing !== null ? 'Listen: each machine plays its fault sound in turn. Remember which number makes which sound.' : `Fix the machine that is making the noise. Up to ${f.maximumActive} can fail at once. Wrong guesses clang loudly.`}</p>
    <div className="fault-grid listen-grid">{[0, 1, 2, 3].map(i => <button key={i} data-tutorial={!coop && i === f.active[0] ? 'fault-box-1' : undefined} className={`machine ${playing === i ? 'playing' : ''}`} aria-label={playing === i ? `Machine ${i + 1}: ${FAULT_SOUNDS[sounds[i]!]}` : `Machine ${i + 1}`} onClick={() => send({ type: 'input', value: i + 1 })}>
      <kbd>{i + 1}</kbd><b>{playing === i ? FAULT_SOUNDS[sounds[i]!] : ''}</b></button>)}</div>
    <div className="you-hear" data-testid="fault-hearing" aria-live="polite"><span>YOU HEAR</span><b>{playing !== null ? 'The rack key' : heard.length ? heard.join(' + ') : 'Nothing from the rack'}</b></div>
    {!coop && <div className="terminal-actions"><button onClick={() => send({ type: 'listen' })} disabled={playing !== null}><kbd>L</kbd> Listen to the rack again</button></div>}
    <div className="task-progress"><span>{f.completed} / {f.required} faults fixed</span><span>{coop ? '1–4 · ASK THE MANUAL' : '1–4 · BY EAR'}</span></div>
  </>;
}

export function LocateTerminal({ g }: { g: GameState }) {
  const l = g.tasks.locate;
  return <><p>The emitter needs to know where it is. Go to the radar and read it. Mark which ring it is in, {l.required} times. It keeps moving, and wrong marks are loud.</p>
    <div className="task-progress"><span>{l.marks} / {l.required} positions marked</span><span>MONITOR · KEYS 1–4</span></div></>;
}

export function LocatePanel({ g, send }: { g: GameState; send: Send }) {
  const l = g.tasks.locate, wait = Math.max(0, l.lastMarkAt + config.tasks.locate.spacingSeconds - g.time);
  return <div className="locate-panel" data-testid="locate-panel">
    <div className="locate-heading"><span>MARK ITS POSITION · {l.marks} / {l.required}</span><small>{wait > 0 ? `Marker recharging · ${wait.toFixed(1)}s` : 'Read the sonar, then mark'}</small></div>
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
    {p.personal && <small className="heart-line">Tuned to your own resting heartbeat from calibration.</small>}
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
    {c.personal && <small className="heart-line">{c.halfSeconds < config.tasks.calm.breathSeconds - 1e-9 ? 'Started at your own breathing pace · slowing with every breath.' : 'Slowed from your own pace to a calm, steady breath.'}</small>}
    <small className="heart-line">{heartLine(g, 'Your pulse is elevated: it can still hear you, so progress is slower.', 'Your pulse is steady: progress is faster.')}</small>
  </>;
}
