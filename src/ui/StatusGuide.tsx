import { config } from '../game/config';
import type { GameState } from '../game/state';

// Exposure readouts are unavailable while the equipment is off.
function exposureReading(g: GameState): string {
  return g.equipment === 'on' ? `${Math.round(g.danger)}%` : 'Gauge dark: equipment off';
}

// Explains the wall status unit when it is clicked. Values are live; game time keeps running.
export default function StatusGuide({ game: g, onClose }: { game: GameState; onClose: () => void }) {
  const remaining = Math.max(0, Math.ceil(config.line.deadlineSeconds - g.time));
  const clock = g.mode === 'tutorial' ? 'Paused during practice' : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} left`;
  return <section className="status-guide" role="dialog" aria-label="Status unit">
    <button className="inspection-close" onClick={onClose}>Close <kbd>Space</kbd></button>
    <div className="status-guide-row"><i className="guide-icon clock" aria-hidden="true">88:88</i><div><b>Containment deadline</b><p>Time remaining to finish all four research stages and the final broadcast. At 0:00 the protocol window closes and the run is lost. It keeps counting while the power is off.</p><small>{clock}</small></div></div>
    <div className="status-guide-row"><i className="guide-icon cell" aria-hidden="true"/><div><b>Isolation cells</b><p>Each press of Q spends one cell to cut the equipment and go quiet for up to {config.shutdown.durationSeconds} seconds. Finishing a research stage recharges one.</p><small>{g.shutdown.chargesRemaining} of {config.shutdown.charges} charged</small></div></div>
    <div className="status-guide-row"><i className="guide-icon gauge" aria-hidden="true"/><div><b>Exposure</b><p>How much of you the creature can hear. Running equipment, mistakes and elapsed time push the needle up; turning the equipment off cools it. The higher it reads, the faster it comes.</p><small>{exposureReading(g)}</small></div></div>
  </section>;
}
