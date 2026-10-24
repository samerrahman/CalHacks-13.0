import { useRef, useState, type PointerEvent, type CSSProperties } from 'react';
import type { WireState } from '../game/state';

const symbols = ['▲', '●', '◆', '■'];
const colors = ['#e7a577', '#82c3b8', '#d3c579', '#b5a1d7'];
/** Pointer drag plus select-source/select-socket buttons for keyboard and touch. */
export default function WirePuzzle({ wires, connect }: { wires: WireState; connect: (from: number, to: number) => void }) {
  const board = useRef<HTMLDivElement>(null);
  const drag = useRef<{ from: number; x: number; y: number; moved: boolean } | null>(null);
  const [selected, select] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
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
        {wires.connections.map((to, from) => to >= 0 && <path key={from} d={`M15 ${12.5 + from * 25} C43 ${12.5 + from * 25} 57 ${12.5 + to * 25} 85 ${12.5 + to * 25}`} stroke={colors[from]}/>)}
        {tip && selected !== null && <path className="dragging" d={`M15 ${12.5 + selected * 25} C43 ${12.5 + selected * 25} 57 ${tip.y} ${tip.x} ${tip.y}`} stroke={colors[selected]}/>}
      </svg>
      <div className="wire-column">{symbols.map((symbol, from) => <button key={symbol} type="button" className={selected === from ? 'selected' : ''} style={{ '--wire-color': colors[from] } as CSSProperties}
        aria-label={`Cable ${symbol}${wires.connections[from] >= 0 ? ' connected' : ''}`} aria-pressed={selected === from} disabled={wires.connections[from] >= 0}
        onPointerDown={event => { if (event.button !== 0) return; select(from); drag.current = { from, x: event.clientX, y: event.clientY, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); setTip(point(event)); }}
        onClick={() => { if (wires.connections[from] < 0) select(from); }}>{symbol}<small>{wires.connections[from] >= 0 ? 'LINKED' : `0${from + 1}`}</small></button>)}</div>
      <div className="wire-column">{wires.targetOrder.map((from, to) => <button key={to} type="button" data-wire-target={to} style={{ '--wire-color': colors[from] } as CSSProperties}
        aria-label={`Socket ${symbols[from]}`} disabled={wires.connections.includes(to)} onClick={() => { if (selected !== null) { connect(selected, to); select(null); } }}>{symbols[from]}<small>{wires.connections.includes(to) ? 'LINKED' : 'SOCKET'}</small></button>)}</div>
    </div>
    <div className="task-progress"><span>{wires.connections.filter(to => to >= 0).length} / 4 cables linked</span><span>WRONG LINK ADDS DANGER</span></div>
  </div>;
}
