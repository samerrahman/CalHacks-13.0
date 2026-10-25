import type { PublicEvent } from '../game/state';
import { biggestRise, causeBefore, type Highlight, type PulseSample } from './highlights';
import type { Standing } from './predictions';

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
export type RecapData = {
  outcome: 'won' | 'lost'; time: number; locks: number; coop: boolean;
  rise: { from: number; to: number; time: number; cause: string | null } | null;
  moments: string[];
  stats: { label: string; value: string }[];
  friend: { label: string; value: string }[];
  standings: Standing[];
};

/** Everything the recap shows, from what this page saw. `events` is every event seen this run (deduplicated). */
export function recapData(outcome: 'won' | 'lost', time: number, stage: number, mode: string, events: readonly PublicEvent[], highlights: readonly Highlight[], pulse: readonly PulseSample[], standings: Standing[] = []): RecapData {
  const count = (type: string, detail?: string) => events.filter(e => e.type === type && (detail === undefined || e.detail === detail)).length;
  const rise = biggestRise(pulse), coop = mode === 'coop';
  return {
    outcome, time, coop, locks: outcome === 'won' ? 4 : Math.max(0, Math.min(4, stage - 1)),
    rise: rise && rise.rise >= 5 ? { from: rise.from, to: rise.to, time: rise.time, cause: causeBefore(events, rise.time, 10) } : null,
    moments: highlights.filter(h => ['close-call', 'left-wall', 'decoy-save', 'steadied'].includes(h.kind)).slice(-4).map(h => h.text),
    stats: [
      { label: 'LOCKS RELEASED', value: `${outcome === 'won' ? 4 : Math.max(0, Math.min(4, stage - 1))} / 4` },
      { label: 'WENT QUIET', value: String(count('QUIET_ENTERED')) },
      { label: 'MISTAKES', value: String(count('WRONG_INPUT')) },
      { label: 'HITS ON THE DOOR', value: String(count('SCARE', 'impact')) },
    ],
    friend: coop ? [
      { label: 'WARNINGS SENT', value: String(count('FRIEND_WARNING')) },
      { label: 'DECOYS FIRED', value: String(count('FRIEND_DECOY')) },
      { label: 'DOOR KEY', value: count('DOOR_UNLOCKED') ? 'Turned' : '—' },
    ] : [],
    standings,
  };
}

/** A 1200×630 picture of the recap for sharing. */
export function drawRecap(data: RecapData): HTMLCanvasElement {
  const canvas = Object.assign(document.createElement('canvas'), { width: 1200, height: 630 }), g = canvas.getContext('2d')!;
  g.fillStyle = '#07090a'; g.fillRect(0, 0, 1200, 630);
  const glow = g.createRadialGradient(260, 140, 20, 260, 140, 520); glow.addColorStop(0, data.outcome === 'won' ? 'rgba(80,130,90,.25)' : 'rgba(150,40,25,.3)'); glow.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = glow; g.fillRect(0, 0, 1200, 630);
  g.fillStyle = '#c9c3a6'; g.font = '600 22px "Special Elite", "Courier New", monospace'; g.fillText('H U S H  ·  RUN RECAP', 60, 70);
  g.fillStyle = data.outcome === 'won' ? '#cfe3c2' : '#e8a08c'; g.font = '700 84px "Special Elite", "Courier New", monospace'; g.fillText(data.outcome === 'won' ? 'THEY ESCAPED' : 'IT GOT THEM', 56, 170);
  g.fillStyle = '#8d9c84'; g.font = '24px "Courier New", monospace'; g.fillText(`${clock(data.time)} · ${data.locks} / 4 locks${data.coop ? ' · co-op' : ''}`, 60, 214);
  let y = 290;
  if (data.rise) { g.fillStyle = '#e7d6a6'; g.font = '700 46px "Courier New", monospace'; g.fillText(`♥ ${data.rise.from} → ${data.rise.to} BPM`, 60, y); g.fillStyle = '#8d9c84'; g.font = '22px "Courier New", monospace'; g.fillText(`biggest jump${data.rise.cause ? `, after ${data.rise.cause}` : ''} (${clock(data.rise.time)})`, 60, y + 34); y += 96; }
  g.font = '22px "Courier New", monospace';
  for (const m of data.moments.slice(0, 3)) { g.fillStyle = '#d99450'; g.fillText('▸', 60, y); g.fillStyle = '#c9c3a6'; g.fillText(m, 88, y); y += 34; }
  const stats = [...data.stats, ...data.friend];
  stats.slice(0, 4).forEach((s, i) => { const x = 60 + i * 270; g.fillStyle = '#e7d6a6'; g.font = '700 34px "Courier New", monospace'; g.fillText(s.value, x, 540); g.fillStyle = '#6f7c68'; g.font = '16px "Courier New", monospace'; g.fillText(s.label, x, 566); });
  if (data.friend.length) { g.fillStyle = '#8d9c84'; g.font = '18px "Courier New", monospace'; g.fillText(data.friend.map(f => `${f.label.toLowerCase()} ${f.value}`).join('  ·  '), 60, 610); }
  if (data.standings.length) {
    g.fillStyle = '#8d9c84'; g.font = '16px "Courier New", monospace'; g.fillText('PREDICTIONS', 860, 290);
    data.standings.slice(0, 5).forEach((s, i) => { g.fillStyle = s.points ? '#e7d6a6' : '#6f7c68'; g.font = '20px "Courier New", monospace'; g.fillText(`${i + 1}. ${s.name.slice(0, 14)}`, 860, 324 + i * 30); g.textAlign = 'right'; g.fillText(String(s.points), 1140, 324 + i * 30); g.textAlign = 'left'; });
  }
  return canvas;
}

export default function Recap({ data }: { data: RecapData }) {
  function save() {
    const link = document.createElement('a');
    link.download = `hush-recap-${data.outcome}-${clock(data.time).replace(':', 'm')}s.png`; link.href = drawRecap(data).toDataURL('image/png'); link.click();
  }
  return <section className={`spectate-card spectate-recap ${data.outcome}`} aria-label="Run recap">
    <small>RUN RECAP <em>from what this page saw</em></small>
    <strong>{data.outcome === 'won' ? 'They escaped.' : 'It got them.'}</strong>
    <span>{clock(data.time)} · {data.locks} / 4 locks released</span>
    {data.rise && <p className="spectate-recap-rise"><b>♥ {data.rise.from} → {data.rise.to} BPM</b> biggest jump{data.rise.cause ? `, after ${data.rise.cause}` : ''} ({clock(data.rise.time)})</p>}
    {data.moments.length > 0 && <ul className="spectate-recap-moments">{data.moments.map(m => <li key={m}>{m}</li>)}</ul>}
    <div className="spectate-recap-stats">{[...data.stats, ...data.friend].map(s => <div key={s.label}><b>{s.value}</b><span>{s.label}</span></div>)}</div>
    <button onClick={save}>Save as image</button>
  </section>;
}
