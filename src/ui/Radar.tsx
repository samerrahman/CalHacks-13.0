import { config } from '../game/config';
import { bearingLabel, creatureBearing } from '../game/creature';
import type { GameState } from '../game/state';

/** Ping radar for the sampled detector reading: a ring sweeps out every reading and reveals a
 * fading dot at the creature's range and bearing. No number; up is ahead of the desk. */
export const RADAR = { size: 168, radius: 74, pingSeconds: 1.2 } as const;
const BANDS: [number, string][] = [[7, 'CLOSE'], [14, 'A'], [22, 'B'], [24, 'C']];

export function radarPoint(range: number, bearing: number): { x: number; y: number } {
  const r = range / config.line.length * RADAR.radius, c = RADAR.size / 2;
  return { x: c + Math.sin(bearing) * r, y: c - Math.cos(bearing) * r };
}

export default function Radar({ g }: { g: GameState }) {
  const L = config.line, c = RADAR.size / 2, since = Math.max(0, g.time - g.creature.sensorSampleAt), range = g.creature.sensorDistance;
  const sweep = Math.min(1, since / RADAR.pingSeconds), next = Math.max(0, L.sensorSeconds - since);
  const bearing = creatureBearing(g.seed, g.creature.sensorSampleAt), share = range === null ? 1 : range / L.length;
  const revealed = range !== null && sweep >= share, dot = range === null ? null : radarPoint(range, bearing);
  const fade = revealed ? Math.max(.18, 1 - (since - share * RADAR.pingSeconds) / L.sensorSeconds) : 0;
  const band = range === null ? null : BANDS.find(([edge]) => range < edge || edge === L.length)![1];
  const described = !revealed || band === null ? 'Radar pinging' : `Radar contact in the ${band === 'CLOSE' ? 'close band' : `band ${band}`}, ${bearingLabel(bearing).toLowerCase()}`;
  return <div className="radar">
    <svg viewBox={`0 0 ${RADAR.size} ${RADAR.size}`} data-testid="radar" role="img" aria-label={described}>
      <circle className="radar-face" cx={c} cy={c} r={RADAR.radius}/>
      {BANDS.slice(0, 3).map(([edge, label]) => <g key={edge}><circle className={edge === L.nearPosition ? 'radar-ring close' : 'radar-ring'} cx={c} cy={c} r={edge / L.length * RADAR.radius}/><text x={c + 3} y={c - edge / L.length * RADAR.radius + 9}>{label === 'CLOSE' ? 'CLOSE' : label}</text></g>)}
      <text x={c + 3} y={c - RADAR.radius + 9}>C</text>
      <line className="radar-cross" x1={c} y1={c - RADAR.radius} x2={c} y2={c + RADAR.radius}/><line className="radar-cross" x1={c - RADAR.radius} y1={c} x2={c + RADAR.radius} y2={c}/>
      <rect className="radar-shelter" x={c - 4} y={c - 4} width={8} height={8}/>
      {range !== null && <circle className="radar-ping" cx={c} cy={c} r={sweep * RADAR.radius} style={{ opacity: 1 - sweep * .85 }}/>}
      {revealed && dot && <circle className="radar-dot" data-testid="radar-dot" cx={dot.x} cy={dot.y} r={4.5} style={{ opacity: fade }}/>}
      <text className="radar-ahead" x={c} y={10} textAnchor="middle">AHEAD</text>
    </svg>
    <div className="radar-caption"><span>{range === null ? 'Radar offline' : `Ping every ${L.sensorSeconds}s`}</span><span>{range === null ? '' : `Next ping ${next.toFixed(1)}s`}</span></div>
  </div>;
}
