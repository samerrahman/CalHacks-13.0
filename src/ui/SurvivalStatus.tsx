import { config } from '../game/config';
import { dangerParts } from '../game/creature';
import type { GameState } from '../game/state';

export default function SurvivalStatus({ game: g }: { game: GameState }) {
  const remaining = Math.max(0, Math.ceil(config.line.deadlineSeconds - g.time));
  const grace = Math.max(0, Math.ceil(config.line.graceSeconds - g.time));
  const powered = g.equipment === 'on';
  const part = dangerParts(g), parts: [string, number][] = [['Base', part.base], ['Time', part.time], ['Work noise', part.noise], ['Isolations', part.isolation], ['Pulse', part.pulse]];
  return <aside className="survival-status" aria-label="Survival resources">
    <div className={remaining <= 60 ? 'deadline urgent' : 'deadline'}><span>{g.mode === 'tutorial' ? 'PRACTICE / TIMER PAUSED' : 'CONTAINMENT DEADLINE'}</span><strong data-testid="run-deadline">{g.mode === 'tutorial' ? '—:—' : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`}</strong></div>
    <div className="isolation-reserve"><span>ISOLATION CELLS</span><b>{g.shutdown.chargesRemaining} / {config.shutdown.charges}</b><div aria-label={`${g.shutdown.chargesRemaining} isolation cells remaining`}>{Array.from({ length: config.shutdown.charges }, (_, n) => <i key={n} className={n < g.shutdown.chargesRemaining ? 'charged' : ''}/>)}</div></div>
    {grace > 0 && g.mode !== 'tutorial' ? <p>SEDATIVE HOLD · {grace}s<br/>Work now. Listen for footsteps.</p> : <p>{g.equipment === 'quiet' ? `AUTO RESTORE IN ${Math.max(0, Math.ceil(g.shutdown.activeUntil - g.time))}s` : g.shutdown.cooldownUntil > g.time ? `ISOLATION RECHARGING · ${Math.ceil(g.shutdown.cooldownUntil - g.time)}s` : `${config.shutdown.durationSeconds}s isolation · finite cells`}</p>}
    {powered && <div className="danger-meter"><span>EXPOSURE <b>{Math.round(g.danger)} / 100</b></span><div role="meter" aria-label="Danger value" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(g.danger)}><i style={{ width: `${g.danger}%` }}/></div>
      <small className="danger-help">Work is loud: it climbs fast while you work and cools when you stop. High exposure makes it rush your wall.</small>
      {g.mode !== 'tutorial' && <dl className="danger-parts" aria-label="What adds exposure">{parts.map(([label, value]) => <div key={label} className={value >= .5 ? '' : 'idle'}><dt>{label}</dt><dd>+{Math.round(value)}</dd></div>)}</dl>}</div>}
  </aside>;
}
