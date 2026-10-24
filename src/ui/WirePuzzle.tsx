import { useRef, useState, type PointerEvent, type CSSProperties } from 'react';
import type { WireState } from '../game/state';
import { wirePanel } from '../game/tasks';

const symbols = ['▲', '●', '◆', '■', '✚', '★'];
const colors = ['#e7a577', '#82c3b8', '#d3c579', '#b5a1d7', '#c98b8b', '#9fc27a'];
/** Pointer drag plus select-source/select-socket buttons for keyboard and touch.
 * Long boards are patched one panel at a time; indices stay global. */
export default function WirePuzzle({ wires, connect }: { wires: WireState; connect: (from: number, to: number) => void }) {
  const board = useRef<HTMLDivElement>(null);
  const drag = useRef<{ from: number; x: number; y: number; moved: boolean } | null>(null);
  const [selected, select] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const panel = wirePanel(wires), rows = Array.from({ length: panel.size }, (_, i) => panel.start + i);
  const row = (index: number) => (index - panel.start + .5) * 100 / panel.size, mark = (index: number) => index - panel.start;
  const linked = wires.connections.filter(to => to >= 0).length;
  function point(event: PointerEvent) {
    const bounds = board.current!.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) / bounds.width * 100, y: (event.clientY - bounds.top) / bounds.height * 100 };
  }
  function release(event: PointerEvent) {
    if (!drag.current) return;
    const current = drag.current;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-wire-target]');
    if (current.moved && target && board.current?.contains(target)) { connect(current.from, Number(target.dataset.wireTarget)); select(null); }
    drag.current = null; setTip(null);
  }
  return <div className="wire-puzzle">
    <div className="wire-instructions"><b>PATCH THE RELAY</b><span>Drag matching symbols together. You can also select a cable, then its socket.</span></div>
    <div className="wire-board" ref={board} onPointerMove={event => {
      if (!drag.current) return;
      if (Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) > 4) drag.current.moved = true;
      setTip(point(event));
    }} onPointerUp={release} onPointerCancel={() => { drag.current = null; setTip(null); select(null); }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {rows.map(from => wires.connections[from] >= 0 && <path key={from} d={`M15 ${row(from)} C43 ${row(from)} 57 ${row(wires.connections[from])} 85 ${row(wires.connections[from])}`} stroke={colors[mark(from)]}/>)}
        {tip && selected !== null && <path className="dragging" d={`M15 ${row(selected)} C43 ${row(selected)} 57 ${tip.y} ${tip.x} ${tip.y}`} stroke={colors[mark(selected)]}/>}
      </svg>
      <div className="wire-column" style={{ gridTemplateRows: `repeat(${panel.size},1fr)` }}>{rows.map(from => <button key={from} type="button" className={selected === from ? 'selected' : ''} style={{ '--wire-color': colors[mark(from)] } as CSSProperties}
        aria-label={`Cable ${symbols[mark(from)]}${wires.connections[from] >= 0 ? ' connected' : ''}`} aria-pressed={selected === from} disabled={wires.connections[from] >= 0}
        onPointerDown={event => { if (event.button !== 0) return; select(from); drag.current = { from, x: event.clientX, y: event.clientY, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); setTip(point(event)); }}
        onClick={() => { if (wires.connections[from] < 0) select(from); }}>{symbols[mark(from)]}<small>{wires.connections[from] >= 0 ? 'LINKED' : String(from + 1).padStart(2, '0')}</small></button>)}</div>
      <div className="wire-column" style={{ gridTemplateRows: `repeat(${panel.size},1fr)` }}>{rows.map(to => { const from = wires.targetOrder[to]; return <button key={to} type="button" data-wire-target={to} style={{ '--wire-color': colors[mark(from)] } as CSSProperties}
        aria-label={`Socket ${symbols[mark(from)]}`} disabled={wires.connections.includes(to)} onClick={() => { if (selected !== null) { connect(selected, to); select(null); } }}>{symbols[mark(from)]}<small>{wires.connections.includes(to) ? 'LINKED' : 'SOCKET'}</small></button>; })}</div>
    </div>
    <div className="task-progress"><span>Panel {panel.index + 1} / {panel.count} · {linked} / {wires.connections.length} cables linked</span><span>WRONG LINK IS LOUD</span></div>
  </div>;
}
