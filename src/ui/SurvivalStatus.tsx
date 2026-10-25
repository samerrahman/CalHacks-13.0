import { config } from '../game/config';
import type { GameState } from '../game/state';

// One short status line, only when something time-limited is happening.
function statusLine(g: GameState): string | null {
  const grace = Math.max(0, Math.ceil(config.line.graceSeconds - g.time));
  if (grace > 0 && g.mode !== 'tutorial') return `SEDATIVE HOLD · ${grace}s`;
  if (g.equipment === 'quiet') return g.quiet?.phase === 'ready' ? 'HOLD F WHEN CLEAR' : `RESTORES IN ${Math.max(0, Math.ceil(g.shutdown.activeUntil - g.time))}s`;
  if (g.shutdown.cooldownUntil > g.time) return `RECHARGING · ${Math.ceil(g.shutdown.cooldownUntil - g.time)}s`;
  return null;
}

// Screen-reader copy of the wall status unit (see drawStatus in src/render/displays.ts).
export default function SurvivalStatus({ game: g }: { game: GameState }) {
  const remaining = Math.max(0, Math.ceil(config.line.deadlineSeconds - g.time));
  const status = statusLine(g);
  return <aside className="survival-status" aria-label="Survival resources">
    <div className={remaining <= 60 ? 'deadline urgent' : 'deadline'}><span>{g.mode === 'tutorial' ? 'PRACTICE' : 'TIME LEFT'}</span><strong data-testid="run-deadline">{g.mode === 'tutorial' ? '—:—' : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`}</strong></div>
    <div className="isolation-reserve"><span>CELLS</span><b>{g.shutdown.chargesRemaining} / {config.shutdown.charges}</b><div aria-label={`${g.shutdown.chargesRemaining} isolation cells remaining`}>{Array.from({ length: config.shutdown.charges }, (_, n) => <i key={n} className={n < g.shutdown.chargesRemaining ? 'charged' : ''}/>)}</div></div>
    {g.equipment === 'on' && <div className="danger-meter"><span>EXPOSURE</span><div role="meter" aria-label="Danger value" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(g.danger)}><i style={{ width: `${g.danger}%` }}/></div></div>}
    {status && <p>{status}</p>}
  </aside>;
}
