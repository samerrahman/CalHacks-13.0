import { config } from '../game/config';
import type { GameState } from '../game/state';

export default function SurvivalStatus({ game: g }: { game: GameState }) {
  const remaining = Math.max(0, Math.ceil(config.line.deadlineSeconds - g.time));
  const grace = Math.max(0, Math.ceil(config.line.graceSeconds - g.time));
  const powered = g.equipment === 'on';
  return <aside className="survival-status" aria-label="Survival resources">
    <div className={remaining <= 60 ? 'deadline urgent' : 'deadline'}><span>{g.mode === 'tutorial' ? 'PRACTICE / TIMER PAUSED' : 'CONTAINMENT DEADLINE'}</span><strong data-testid="run-deadline">{g.mode === 'tutorial' ? '—:—' : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`}</strong></div>
    <div className="isolation-reserve"><span>ISOLATION CELLS</span><b>{g.shutdown.chargesRemaining} / {config.shutdown.charges}</b><div aria-label={`${g.shutdown.chargesRemaining} isolation cells remaining`}>{Array.from({ length: config.shutdown.charges }, (_, n) => <i key={n} className={n < g.shutdown.chargesRemaining ? 'charged' : ''}/>)}</div></div>
    {grace > 0 && g.mode !== 'tutorial' ? <p>SEDATIVE HOLD · {grace}s<br/>Work now. Listen for the alarm.</p> : <p>{g.equipment === 'quiet' ? `AUTO RESTORE IN ${Math.max(0, Math.ceil(g.shutdown.activeUntil - g.time))}s` : g.shutdown.cooldownUntil > g.time ? `ISOLATION RECHARGING · ${Math.ceil(g.shutdown.cooldownUntil - g.time)}s` : '10s isolation · finite cells'}</p>}
    {powered && <div className="danger-meter"><span>EXPOSURE <b>{Math.round(g.danger)} / 100</b></span><div role="meter" aria-label="Danger value" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(g.danger)}><i style={{ width: `${g.danger}%` }}/></div></div>}
  </aside>;
}
