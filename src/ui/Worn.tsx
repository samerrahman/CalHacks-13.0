// Shared pieces of the menu look (see handdrawn.css): a chipped, crooked typewriter title and
// a faltering heartbeat line. Used by the start screen, pause menu and run report.
const TILTS = ['translateY(-2px)', 'translateY(6px) rotate(-3deg)', 'translateY(-5px) rotate(4deg)', 'translateY(3px) rotate(-1deg)', 'translateY(-3px) rotate(2deg)', 'translateY(4px) rotate(-2deg)'];

export function WornTitle({ text, level = 1, className = '' }: { text: string; level?: 1 | 2; className?: string }) {
  const Tag = level === 1 ? 'h1' : 'h2';
  return <Tag className={`worn-title ${className}`} aria-label={text}>
    {[...text].map((letter, i) => letter === ' '
      ? <span key={i} className="worn-gap" aria-hidden="true"> </span>
      : <span key={i} className={`letter l${i % 4}`} style={{ transform: TILTS[(i * 7) % TILTS.length] }} aria-hidden="true">{letter}</span>)}
  </Tag>;
}

export function Heartbeat() {
  return <svg className="worn-pulse" viewBox="0 0 420 40" aria-hidden="true"><path d="M0 22H150L158 22 164 6 172 38 178 22H232L240 22 244 14 248 22H420"/></svg>;
}
