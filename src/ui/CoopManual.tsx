import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { CoopManual as Manual } from '../game/coop';
import { socketCode } from '../game/coop';
import { coopBook, LOCATE_BANDS, MEMORY_GLYPHS, type CoopBook } from '../game/book';
import { FAULT_SOUNDS } from '../game/tasks';
import { CoopManualFeed, currentManual, type CoopFeedState } from '../integrations/coop';
import { WIRE_COLORS, WIRE_SYMBOLS } from './WirePuzzle';
import './coop.css';

const SIDES: [number, string, string][] = [[1, 'up', 'M20 20V0'], [2, 'right', 'M20 20H40'], [4, 'down', 'M20 20V40'], [8, 'left', 'M20 20H0']];
const sides = (open: number) => SIDES.filter(([bit]) => open & bit).map(([, name]) => name).join(' and ');

export const BOOK_PAGES = ['contents', 'faults', 'cables', 'conduit', 'signal', 'radar', 'breathing', 'heartbeat', 'door'] as const;
export type BookPageId = typeof BOOK_PAGES[number];
const TITLES: Record<BookPageId, string> = { contents: 'Field manual', faults: 'Rack fault sounds', cables: 'Cable patch codes', conduit: 'Conduit boards', signal: 'Signal symbols', radar: 'Radar range keys', breathing: 'Breathing pacer', heartbeat: 'Heartbeat mask', door: 'Basement door key' };
/** Live readings some pages use: the creature's range from the trace and the live pacer page. */
export type BookLive = { metres: number | null; calm: Extract<Manual, { kind: 'calm' }> | null };

function Faults({ book }: { book: CoopBook }) {
  return <>
    <p>Ask which research stage they are on and what the failing machine sounds like. Tell them the machine number to press. Each stage's rack is wired differently.</p>
    <div className="book-columns">{book.faults.map(({ stage, machines }) => <table key={stage} className="coop-key"><caption>RESEARCH {stage}</caption><thead><tr><th>If they hear</th><th>Press</th></tr></thead>
      <tbody>{FAULT_SOUNDS.map((name, sound) => <tr key={name}><td>{name.toLowerCase()}</td><td><kbd>{machines[sound]! + 1}</kbd></td></tr>)}</tbody></table>)}</div>
  </>;
}
function Cables({ book }: { book: CoopBook }) {
  return <>
    <p>Ask for the research stage, the panel number, and each cable's symbol. Tell them the code on the socket it plugs into.</p>
    <div className="book-columns">{book.cables.map(({ stage, panel, panels, codes }) => <div key={`${stage}-${panel}`} className="book-panel">
      <h3>RESEARCH {stage} · PANEL {panel + 1}{panels > 1 ? ` OF ${panels}` : ''}</h3>
      <ol className="coop-cables">{codes.map((code, cable) => <li key={cable} style={{ '--wire-color': WIRE_COLORS[cable] } as CSSProperties}>
        <b aria-label={`Cable ${WIRE_SYMBOLS[cable]}`}>{WIRE_SYMBOLS[cable]}</b><i aria-hidden="true">→</i><strong aria-label={`socket ${socketCode(code)}`}>{socketCode(code)}</strong></li>)}</ol>
    </div>)}</div>
  </>;
}
function Board({ board }: { board: CoopBook['boards'][number] }) {
  const { size, start, end, tiles } = board;
  return <div className="book-board" role="group" aria-label={`Board with IN on row ${start + 1} and OUT on row ${end + 1}`}>
    <h3>IN ROW {start + 1} · OUT ROW {end + 1}</h3>
    <div className="coop-conduit" style={{ gridTemplateColumns: `20px repeat(${size}, 1fr) 20px` }}>
      <span/>{Array.from({ length: size }, (_, col) => <span key={col} className="coop-axis">{col + 1}</span>)}<span/>
      {Array.from({ length: size }, (_, row) => <div key={row} className="coop-conduit-row">
        <span className={`coop-axis ${row === start ? 'port' : ''}`}>{row === start ? 'IN▸' : row + 1}</span>
        {Array.from({ length: size }, (_, col) => { const open = tiles[row * size + col]!;
          return <div key={col} className={`coop-tile ${open ? 'route' : ''}`} role="img" aria-label={`Row ${row + 1}, column ${col + 1}: ${open ? `joins ${sides(open)}` : 'off the route'}`}>
            {open ? <svg viewBox="0 0 40 40" aria-hidden="true">{SIDES.filter(([bit]) => open & bit).map(([bit, , d]) => <path key={bit} d={d}/>)}<circle cx="20" cy="20" r="4.5"/></svg> : <i aria-hidden="true">·</i>}</div>; })}
        <span className={`coop-axis ${row === end ? 'port' : ''}`}>{row === end ? '▸OUT' : ''}</span>
      </div>)}
    </div>
  </div>;
}
function Conduit({ book }: { book: CoopBook }) {
  return <>
    <p>Ask which rows IN and OUT are on and find that board. Then talk them through each drawn tile: row, column and which sides it joins. Tiles marked · are off the route and can stay as they are. Then they press T.</p>
    <div className="book-boards">{book.boards.map(board => <Board key={`${board.start}-${board.end}`} board={board}/>)}</div>
  </>;
}
function Signal({ book }: { book: CoopBook }) {
  return <>
    <p>During playback they see symbols, not digits. Ask them to name each symbol in order, and read back the digits. A wrong digit wipes their entry; start from the first.</p>
    <div className="book-columns">{book.memory.map(({ stage, glyphFor }) => <table key={stage} className="coop-key"><caption>RESEARCH {stage}</caption><thead><tr><th>If they see</th><th>Digit</th></tr></thead>
      <tbody>{glyphFor.map((glyph, digit) => ({ glyph, digit })).sort((a, b) => a.glyph - b.glyph).map(({ glyph, digit }) => <tr key={glyph}><td><span className="book-glyph" aria-hidden="true">{MEMORY_GLYPHS[glyph]!.glyph}</span>{MEMORY_GLYPHS[glyph]!.name.toLowerCase()}</td><td><kbd>{digit + 1}</kbd></td></tr>)}</tbody></table>)}</div>
  </>;
}
function Radar({ book, metres }: { book: CoopBook; metres: number | null }) {
  return <>
    <p>Their radar is dark while they mark. Read its range (here, or on your outside camera), find the band, and tell them the key. It keeps moving, so check before every mark. On a band edge either key works.</p>
    <table className="coop-key"><thead><tr><th>If it is</th><th>Key</th></tr></thead>
      <tbody>{LOCATE_BANDS.map((b, i) => <tr key={b.sector}><td>{b.name}</td><td><kbd>{book.locate[i]}</kbd></td></tr>)}</tbody></table>
    <div className={`book-live${metres !== null ? ' on' : ''}`} role="status"><small>RANGE NOW</small><strong>{metres === null ? '—' : `${Math.round(metres)} m`}</strong></div>
  </>;
}
/** The pacer runs on this device's clock, re-anchored on every live page (each says how far into the half-breath it is). */
function Breathing({ calm }: { calm: BookLive['calm'] }) {
  const [anchor, setAnchor] = useState(() => performance.now()), [now, setNow] = useState(() => performance.now());
  useEffect(() => { setAnchor(performance.now()); }, [calm?.inhale, calm?.halfTenths, calm?.elapsedTenths]);
  useEffect(() => { const timer = setInterval(() => setNow(performance.now()), 100); return () => clearInterval(timer); }, []);
  const intro = <p>They hold B to breathe in and let go to breathe out, but they can't see the pacer. Call it for them: "in" while they should hold, "out" while they let go. Matching it builds calm; drifting off it doesn't.</p>;
  if (!calm) return <>{intro}<div className="coop-pacer idle" role="status"><strong>THE PACER SHOWS HERE</strong><span>while they are on the calm hold</span></div></>;
  const half = calm.halfTenths / 10, t = calm.elapsedTenths / 10 + Math.max(0, now - anchor) / 1000;
  const inhale = Math.floor(t / half) % 2 === 0 ? calm.inhale : !calm.inhale, left = half - (t % half);
  return <>{intro}
    <div className={`coop-pacer ${inhale ? 'in' : 'out'}`} role="status"><strong>{inhale ? 'BREATHE IN · HOLD B' : 'BREATHE OUT · LET GO'}</strong><span>{left.toFixed(1)} s</span></div>
    <span className="coop-sub">CALM {calm.progress} / {calm.required} S · {half.toFixed(1)} S PER HALF-BREATH · LIVE</span></>;
}
function Door({ book }: { book: CoopBook }) {
  return <>
    <p>Once all four locks are released, the basement door motor needs your key too. Read these digits to the player in order; they press 1–4 at the terminal. A wrong digit buzzes loudly and they start over.</p>
    <div className="coop-door-key" role="img" aria-label={`Door key ${book.door.join(' ')}`}>{book.door.map((digit, i) => <kbd key={i}>{digit}</kbd>)}</div>
  </>;
}
function Contents({ go }: { go: (page: BookPageId) => void }) {
  return <>
    <p>The player describes what they see; you find the answer here and tell them. They cannot see this book. Every answer changes with each new run, and so does the order the puzzles come in, so ask what they're on.</p>
    <ol className="book-contents">{BOOK_PAGES.slice(1).map((id, i) => <li key={id}><button onClick={() => go(id)}><span>{TITLES[id]}</span><i aria-hidden="true"/><b>{i + 1}</b></button></li>)}</ol>
  </>;
}

/** One page of the book. */
export function BookPage({ id, book, live, go = () => {} }: { id: BookPageId; book: CoopBook; live: BookLive; go?: (page: BookPageId) => void }) {
  const index = BOOK_PAGES.indexOf(id);
  return <div className={`coop-page book-page-${id}`}>
    <h2>{TITLES[id]} <small>{index ? `PAGE ${index}` : 'CONTENTS'}</small></h2>
    {id === 'contents' ? <Contents go={go}/> : id === 'faults' ? <Faults book={book}/> : id === 'cables' ? <Cables book={book}/> : id === 'conduit' ? <Conduit book={book}/> : id === 'signal' ? <Signal book={book}/>
      : id === 'radar' ? <Radar book={book} metres={live.metres}/> : id === 'breathing' ? <Breathing calm={live.calm}/> : id === 'door' ? <Door book={book}/>
        : <p>Nothing to look up: the false heartbeat flashes on their screen and they tap 1 with it. Help them keep the beat, and keep them calm.</p>}
  </div>;
}

/** The friend's manual in a co-op run: a book they flip through, printed from the run's seed. Mount it
 * only when the trace mode is 'coop'. `interference` (the creature is close) breaks the pages up with static. */
export default function CoopManual({ hash, feed: shared, seed, metres, interference = false }: { hash: string; feed?: CoopManualFeed | null; seed: number; metres: number | null; interference?: boolean }) {
  const [state, setState] = useState<CoopFeedState | null>(null), [now, setNow] = useState(() => performance.now());
  const [page, setPage] = useState<BookPageId>('contents'), [turn, setTurn] = useState<'next' | 'prev' | null>(null), turnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const feed = shared ?? new CoopManualFeed(hash), off = feed.subscribe(next => { setState(next); setNow(performance.now()); }), clock = setInterval(() => setNow(performance.now()), 500);
    return () => { off(); clearInterval(clock); if (!shared) feed.dispose(); };
  }, [hash, shared]);
  useEffect(() => () => { if (turnTimer.current) clearTimeout(turnTimer.current); }, []);
  const book = useMemo(() => coopBook(seed), [seed]), manual = state ? currentManual(state, now) : null;
  const live: BookLive = { metres, calm: manual?.kind === 'calm' ? manual : null };
  const index = BOOK_PAGES.indexOf(page);
  function go(next: BookPageId) {
    if (next === page) return;
    setTurn(BOOK_PAGES.indexOf(next) > index ? 'next' : 'prev'); setPage(next);
    if (turnTimer.current) clearTimeout(turnTimer.current); turnTimer.current = setTimeout(() => setTurn(null), 420);
  }
  const step = (delta: number) => go(BOOK_PAGES[Math.max(0, Math.min(BOOK_PAGES.length - 1, index + delta))]!);
  const keys = (event: KeyboardEvent) => { if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); step(1); } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); step(-1); } };
  return <section className={`spectate-card coop-manual coop-book${interference ? ' interference' : ''}`} aria-label="The manual" onKeyDown={keys}>
    <small>THE MANUAL · CO-OP <em>{interference ? 'INTERFERENCE · it is close' : `Run ${seed} · only you have this book`}</em></small>
    <nav className="book-tabs" aria-label="Manual pages">{BOOK_PAGES.map((id, i) => <button key={id} className={`${id === page ? 'open' : ''}${id === 'breathing' && live.calm ? ' live' : ''}`} aria-current={id === page ? 'page' : undefined} aria-label={TITLES[id]} title={TITLES[id]} onClick={() => go(id)}>{i ? i : '≡'}</button>)}</nav>
    <div className="book-spread">
      <div key={page} className={`book-sheet${turn ? ` turn-${turn}` : ''}`} tabIndex={-1}><BookPage id={page} book={book} live={live} go={go}/></div>
      {interference && <div className="book-static" aria-hidden="true"/>}
    </div>
    <div className="book-turn"><button onClick={() => step(-1)} disabled={index === 0} aria-label="Previous page">◀ {index > 0 ? TITLES[BOOK_PAGES[index - 1]!] : ''}</button><span>{index} / {BOOK_PAGES.length - 1}</span><button onClick={() => step(1)} disabled={index === BOOK_PAGES.length - 1} aria-label="Next page">{index < BOOK_PAGES.length - 1 ? TITLES[BOOK_PAGES[index + 1]!] : ''} ▶</button></div>
    <span className="coop-note">The player can't see this book; talk them through it. ← and → turn the pages. {state?.status ?? ''}</span>
  </section>;
}
