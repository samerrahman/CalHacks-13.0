import { useEffect, useState, type CSSProperties } from 'react';
import type { CoopManual as Manual } from '../game/coop';
import { socketCode } from '../game/coop';
import { FAULT_SOUNDS } from '../game/tasks';
import { CoopManualFeed, currentManual, type CoopFeedState } from '../integrations/coop';
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

const TITLES: Record<Manual['kind'], string> = { faults: 'Rack sound key', wires: 'Cable patch', routing: 'Conduit route' };
/** One page: the key for the player's live task only. */
export function ManualPage({ manual }: { manual: Manual | null }) {
  if (!manual) return <div className="coop-empty"><strong>No page right now.</strong><span>Help them listen for footsteps.</span></div>;
  return <div className={`coop-page coop-${manual.kind}`}>
    <h2>{TITLES[manual.kind]} <small>STAGE {manual.stage}</small></h2>
    {manual.kind === 'faults' ? <Faults manual={manual}/> : manual.kind === 'wires' ? <Wires manual={manual}/> : <Routing manual={manual}/>}
  </div>;
}

/** Spectator panel for a co-op run. Mount it only when the trace mode is 'coop'; it reads the link in `hash`. */
export default function CoopManual({ hash }: { hash: string }) {
  const [state, setState] = useState<CoopFeedState | null>(null), [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const feed = new CoopManualFeed(hash), off = feed.subscribe(next => { setState(next); setNow(performance.now()); }), clock = setInterval(() => setNow(performance.now()), 500);
    return () => { off(); clearInterval(clock); feed.dispose(); };
  }, [hash]);
  const manual = state ? currentManual(state, now) : null;
  return <section className="spectate-card coop-manual" aria-live="polite">
    <small>THE MANUAL</small>
    <ManualPage manual={manual}/>
    <span className="coop-note">Only you can see this.</span>
  </section>;
}
