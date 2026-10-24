import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type CSSProperties } from 'react';
import type { WireState } from '../game/state';
import { wirePanel } from '../game/tasks';

const symbols = ['▲', '●', '◆', '■', '✚', '★'];
const colors = ['#e7a577', '#82c3b8', '#d3c579', '#b5a1d7', '#c98b8b', '#9fc27a'];
type Anchor = { x: number; y: number };
type Layout = { width: number; height: number; cables: Anchor[]; sockets: Anchor[] };
/** Wires are drawn from the measured boxes (cable right edge to socket left edge, at their vertical
 * centres) in board pixels, so they always land on the buttons whatever the CSS row sizing does. */
function wire(from: Anchor, to: Anchor) {
  const bend = (to.x - from.x) * .4;
  return `M${from.x} ${from.y} C${from.x + bend} ${from.y} ${to.x - bend} ${to.y} ${to.x} ${to.y}`;
}
/** Pointer drag plus select-source/select-socket buttons for keyboard and touch.
 * Long boards are patched one panel at a time; indices stay global. */
export default function WirePuzzle({ wires, connect }: { wires: WireState; connect: (from: number, to: number) => void }) {
  const board = useRef<HTMLDivElement>(null), cableColumn = useRef<HTMLDivElement>(null), socketColumn = useRef<HTMLDivElement>(null);
  const drag = useRef<{ from: number; x: number; y: number; moved: boolean } | null>(null);
  const [selected, select] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const panel = wirePanel(wires), rows = Array.from({ length: panel.size }, (_, i) => panel.start + i);
  const mark = (index: number) => index - panel.start;
  const linked = wires.connections.filter(to => to >= 0).length;
  const measure = useCallback(() => {
    const host = board.current;
    if (!host) return;
    const bounds = host.getBoundingClientRect();
    const anchors = (column: HTMLDivElement | null, edge: 'left' | 'right') => Array.from(column?.children ?? [], child => {
      const box = child.getBoundingClientRect();
      return { x: box[edge] - bounds.left, y: box.top + box.height / 2 - bounds.top };
    });
    const next = { width: bounds.width, height: bounds.height, cables: anchors(cableColumn.current, 'right'), sockets: anchors(socketColumn.current, 'left') };
    setLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, []);
  useLayoutEffect(measure);
  useEffect(() => {
    if (!board.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(board.current);
    return () => observer.disconnect();
  }, [measure]);
  const cableAt = (index: number) => layout?.cables[mark(index)], socketAt = (index: number) => layout?.sockets[mark(index)];
  function point(event: PointerEvent) {
    const bounds = board.current!.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
  }
  function release(event: PointerEvent) {
    if (!drag.current) return;
    const current = drag.current;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-wire-target]');
    if (current.moved && target && board.current?.contains(target)) { connect(current.from, Number(target.dataset.wireTarget)); select(null); }
    drag.current = null; setTip(null);
  }
  const dragFrom = selected === null ? undefined : cableAt(selected);
  return <div className="wire-puzzle">
    <div className="wire-instructions"><b>PATCH THE RELAY</b><span>Drag matching symbols together. You can also select a cable, then its socket.</span></div>
    <div className="wire-board" ref={board} onPointerMove={event => {
      if (!drag.current) return;
      if (Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) > 4) drag.current.moved = true;
      setTip(point(event));
    }} onPointerUp={release} onPointerCancel={() => { drag.current = null; setTip(null); select(null); }}>
      {layout && <svg viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="none" aria-hidden="true">
        {rows.map(from => { const start = cableAt(from), end = wires.connections[from] >= 0 ? socketAt(wires.connections[from]) : undefined;
          return start && end && <path key={from} d={wire(start, end)} stroke={colors[mark(from)]}/>; })}
        {tip && dragFrom && <path className="dragging" d={wire(dragFrom, { x: tip.x * layout.width, y: tip.y * layout.height })} stroke={colors[mark(selected!)]}/>}
      </svg>}
      <div className="wire-column" ref={cableColumn} style={{ gridTemplateRows: `repeat(${panel.size},minmax(0,1fr))` }}>{rows.map(from => <button key={from} type="button" className={selected === from ? 'selected' : ''} style={{ '--wire-color': colors[mark(from)] } as CSSProperties}
        aria-label={`Cable ${symbols[mark(from)]}${wires.connections[from] >= 0 ? ' connected' : ''}`} aria-pressed={selected === from} disabled={wires.connections[from] >= 0}
        onPointerDown={event => { if (event.button !== 0) return; select(from); drag.current = { from, x: event.clientX, y: event.clientY, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); setTip(point(event)); }}
        onClick={() => { if (wires.connections[from] < 0) select(from); }}>{symbols[mark(from)]}<small>{wires.connections[from] >= 0 ? 'LINKED' : String(from + 1).padStart(2, '0')}</small></button>)}</div>
      <div className="wire-column" ref={socketColumn} style={{ gridTemplateRows: `repeat(${panel.size},minmax(0,1fr))` }}>{rows.map(to => { const from = wires.targetOrder[to]; return <button key={to} type="button" data-wire-target={to} style={{ '--wire-color': colors[mark(from)] } as CSSProperties}
        aria-label={`Socket ${symbols[mark(from)]}`} disabled={wires.connections.includes(to)} onClick={() => { if (selected !== null) { connect(selected, to); select(null); } }}>{symbols[mark(from)]}<small>{wires.connections.includes(to) ? 'LINKED' : 'SOCKET'}</small></button>; })}</div>
    </div>
    <div className="task-progress"><span>Panel {panel.index + 1} / {panel.count} · {linked} / {wires.connections.length} cables linked</span><span>WRONG LINK IS LOUD</span></div>
  </div>;
}
