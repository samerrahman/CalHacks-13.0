import { useEffect, useState, type CSSProperties } from 'react';
import type { CoopManual as Manual } from '../game/coop';
import { socketCode } from '../game/coop';
import { FAULT_SOUNDS } from '../game/tasks';
import { CoopManualFeed, currentManual, type CoopFeedState } from '../integrations/coop';
import { SECTORS } from './ThinkingTasks';
import { WIRE_COLORS, WIRE_SYMBOLS } from './WirePuzzle';
import './coop.css';

const SIDES: [number, string, string][] = [[1, 'up', 'M20 20V0'], [2, 'right', 'M20 20H40'], [4, 'down', 'M20 20V40'], [8, 'left', 'M20 20H0']];
const sides = (open: number) => SIDES.filter(([bit]) => open & bit).map(([, name]) => name).join(' and ');

function Faults({ manual }: { manual: Extract<Manual, { kind: 'faults' }> }) {
  return <>
    <p>Ask what they hear. Tell them the number.{manual.stage === 3 ? ' Two can fail at once.' : ''}</p>
    <table className="coop-key"><thead><tr><th>If they hear</th><th>Press</th></tr></thead>
      <tbody>{FAULT_SOUNDS.map((name, sound) => <tr key={name}><td>{name.toLowerCase()}</td><td><kbd>{manual.sounds.indexOf(sound) + 1}</kbd></td></tr>)}</tbody></table>
  </>;
}

function Wires({ manual }: { manual: Extract<Manual, { kind: 'wires' }> }) {
  return <>
    <p>Panel {manual.panel + 1} of {manual.panels}. They read a symbol; you give the socket, A to {socketCode(manual.sockets.length - 1)} from the top.</p>
    <ol className="coop-cables">{manual.sockets.map((socket, cable) => <li key={cable} style={{ '--wire-color': WIRE_COLORS[cable] } as CSSProperties}>
      <b aria-label={`Cable ${WIRE_SYMBOLS[cable]}`}>{WIRE_SYMBOLS[cable]}</b><i aria-hidden="true">→</i><strong aria-label={`socket ${socketCode(socket)}`}>{socketCode(socket)}</strong></li>)}</ol>
  </>;
}

function Routing({ manual }: { manual: Extract<Manual, { kind: 'routing' }> }) {
  const { size, start, end, tiles } = manual;
  return <>
    <p>Tell them how each tile points. Tiles marked · don't matter. Then T.</p>
    <div className="coop-conduit" style={{ gridTemplateColumns: `22px repeat(${size}, 1fr) 22px` }}>
      <span/>{Array.from({ length: size }, (_, col) => <span key={col} className="coop-axis">{col + 1}</span>)}<span/>
      {Array.from({ length: size }, (_, row) => <div key={row} className="coop-conduit-row">
        <span className={`coop-axis ${row === start ? 'port' : ''}`}>{row === start ? 'IN ▸' : row + 1}</span>
        {Array.from({ length: size }, (_, col) => { const open = tiles[row * size + col]!;
          return <div key={col} className={`coop-tile ${open ? 'route' : ''}`} role="img" aria-label={`Row ${row + 1}, column ${col + 1}: ${open ? `joins ${sides(open)}` : 'off the route'}`}>
            {open ? <svg viewBox="0 0 40 40" aria-hidden="true">{SIDES.filter(([bit]) => open & bit).map(([bit, , d]) => <path key={bit} d={d}/>)}<circle cx="20" cy="20" r="4.5"/></svg> : <i aria-hidden="true">·</i>}</div>; })}
        <span className={`coop-axis ${row === end ? 'port' : ''}`}>{row === end ? '▸ OUT' : ''}</span>
      </div>)}
    </div>
  </>;
}

function Memory({ manual }: { manual: Extract<Manual, { kind: 'memory' }> }) {
  return <>
    <p>{manual.playing ? 'The terminal is playing the sequence to them, but they only see static. Get ready to read it out.' : 'Read the sequence out, one digit at a time. A wrong digit wipes what they entered; start again from the first.'}</p>
    <ol className="coop-sequence" aria-label={`Sequence ${manual.sequence.join(' ')}`}>{manual.sequence.map((digit, i) => <li key={i} className={i < manual.entered ? 'done' : i === manual.entered && !manual.playing ? 'next' : ''}>{digit}</li>)}</ol>
    <span className="coop-sub">{manual.playing ? 'PLAYBACK RUNNING · WAIT' : `ENTERED ${manual.entered} / ${manual.sequence.length}`}</span>
  </>;
}

function Locate({ manual }: { manual: Extract<Manual, { kind: 'locate' }> }) {
  const keys = manual.rings.map(ring => ring + 1);
  return <>
    <p>Their radar is dark. You see where it is: tell them which key to press on the monitor. It keeps moving, so check this page again before every mark.</p>
    <div className="coop-rings">{manual.rings.map(ring => <strong key={ring}><kbd>{ring + 1}</kbd>{SECTORS[ring]![1]} · {SECTORS[ring]![2]}</strong>)}</div>
    <span className="coop-sub">{keys.length > 1 ? `ON A BOUNDARY · ${keys.join(' OR ')} BOTH WORK` : `PRESS ${keys[0]}`} · {manual.marks} / {manual.required} MARKED</span>
  </>;
}

/** The pacer runs on this device's clock, re-anchored on every page (each says how far into the half-breath it is). */
function Calm({ manual }: { manual: Extract<Manual, { kind: 'calm' }> }) {
  const [anchor, setAnchor] = useState(() => performance.now()), [now, setNow] = useState(() => performance.now());
  useEffect(() => { setAnchor(performance.now()); }, [manual.inhale, manual.halfTenths, manual.elapsedTenths]);
  useEffect(() => { const timer = setInterval(() => setNow(performance.now()), 100); return () => clearInterval(timer); }, []);
  const half = manual.halfTenths / 10, t = manual.elapsedTenths / 10 + Math.max(0, now - anchor) / 1000;
  const inhale = Math.floor(t / half) % 2 === 0 ? manual.inhale : !manual.inhale, left = half - (t % half);
  return <>
    <p>The player can't see the pacer. Call it for them: "in" while they should hold B, "out" while they let go. Matching it builds calm; drifting off it doesn't.</p>
    <div className={`coop-pacer ${inhale ? 'in' : 'out'}`} role="status"><strong>{inhale ? 'BREATHE IN · HOLD B' : 'BREATHE OUT · LET GO'}</strong><span>{left.toFixed(1)} s</span></div>
    <span className="coop-sub">CALM {manual.progress} / {manual.required} S · {half.toFixed(1)} S PER HALF-BREATH</span>
  </>;
}

function Door({ manual }: { manual: Extract<Manual, { kind: 'door' }> }) {
  return <>
    <p>All four locks are released. The basement door motor needs your key too. Read these digits to the player in order; they press 1–4 at the terminal. A wrong digit buzzes loudly and they start over.</p>
    <div className="coop-door-key" role="img" aria-label={`Door key ${manual.key.join(' ')}`}>{manual.key.map((digit, i) => <kbd key={i}>{digit}</kbd>)}</div>
  </>;
}

const TITLES: Record<Manual['kind'], string> = { faults: 'Rack sound key', wires: 'Cable patch', routing: 'Conduit route', memory: 'Signal sequence', locate: 'Radar reading', calm: 'Breathing pacer', door: 'Basement door key' };
/** One page: the key for the player's live task only. */
export function ManualPage({ manual }: { manual: Manual | null }) {
  if (!manual) return <div className="coop-empty"><strong>No page right now.</strong><span>Help them listen for footsteps. Warn them when it gets close, or earn a decoy below.</span></div>;
  return <div className={`coop-page coop-${manual.kind}`}>
    <h2>{TITLES[manual.kind]} <small>STAGE {manual.stage}</small></h2>
    {manual.kind === 'faults' ? <Faults manual={manual}/> : manual.kind === 'wires' ? <Wires manual={manual}/> : manual.kind === 'memory' ? <Memory manual={manual}/> : manual.kind === 'locate' ? <Locate manual={manual}/> : manual.kind === 'calm' ? <Calm manual={manual}/> : manual.kind === 'door' ? <Door manual={manual}/> : <Routing manual={manual}/>}
  </div>;
}

/** Spectator panel for a co-op run. Mount it only when the trace mode is 'coop'; it reads the link in `hash`. */
export default function CoopManual({ hash, feed: shared }: { hash: string; feed?: CoopManualFeed | null }) {
  const [state, setState] = useState<CoopFeedState | null>(null), [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const feed = shared ?? new CoopManualFeed(hash), off = feed.subscribe(next => { setState(next); setNow(performance.now()); }), clock = setInterval(() => setNow(performance.now()), 500);
    return () => { off(); clearInterval(clock); if (!shared) feed.dispose(); };
  }, [hash, shared]);
  const manual = state ? currentManual(state, now) : null;
  return <section className="spectate-card coop-manual" aria-live="polite">
    <small>THE MANUAL</small>
    <ManualPage manual={manual}/>
    <span className="coop-note">Only you can see this.</span>
  </section>;
}
