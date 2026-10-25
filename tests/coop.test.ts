import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { config, createGame, dispatch, step } from '../src/game/reducer';
import { buildDirectorRequest } from '../src/game/directorValidation';
import { coopManual, socketCode, type CoopManual } from '../src/game/coop';
import { coopBook, LOCATE_BANDS, MEMORY_GLYPHS, memoryGlyphs, wireCodes, type CoopBook } from '../src/game/book';
import { FAULT_SOUNDS, calmInhale, faultSounds, listeningTo, sectorsAt, stageSteps, tileOpenings, wirePanel } from '../src/game/tasks';
import type { GameState } from '../src/game/state';
import type { SensorView } from '../src/sensing/types';
import { publicDirectorRequest } from '../src/integrations/contracts';
import { sanitizedTrace } from '../src/integrations/client';
import WirePuzzle from '../src/ui/WirePuzzle';

// ThinkingTasks imports its stylesheet; stub CSS so the real components render in Node.
registerHooks({ resolve: (specifier, context, next) => specifier.endsWith('.css') ? { url: 'data:text/javascript,', shortCircuit: true } : next(specifier, context) });
const { ConduitTask, FaultTask } = await import('../src/ui/ThinkingTasks');
const { BookPage, BOOK_PAGES } = await import('../src/ui/CoopManual');

const sensor: SensorView = { source: 'manual', status: 'manual', trend: 'UNKNOWN', quality: 'unknown', hint: '', baselineBpm: null, pulseBpm: null, ageMs: null, sampleAtMs: null, captureSegment: 0, acceptedSeconds: 0, canContinueManual: true };
const noop = () => {};
function still(mode: GameState['mode'], seed = 17): GameState { const s = createGame(seed, mode); s.creature.nextMoveAt = 1e6; s.blackout.nextAt = 1e6; return s; }
const wrongs = (s: GameState) => s.events.filter(e => e.type === 'WRONG_INPUT').length;

/** One puzzle, played the co-op way: the player says what they see, the friend answers from the book only. */
function playStep(s: GameState, book: CoopBook): GameState {
  const t = s.tasks, stage = t.stage;
  if (t.step === 'faults') {
    const machine = t.faults.active[0];
    if (machine === undefined) return step(s, .2);
    const heard = faultSounds(s)[machine]!, page = book.faults.find(f => f.stage === stage)!; // "I hear a high whine"
    return dispatch(s, { type: 'input', value: page.machines[heard]! + 1 });
  }
  if (t.step === 'wires') {
    const panel = wirePanel(t.wires), cable = t.wires.connections.slice(panel.start, panel.start + panel.size).indexOf(-1);
    const page = book.cables.find(c => c.stage === stage && c.panel === panel.index)!, code = page.codes[cable]!; // "panel 2, the star"
    // The player finds the socket showing that code (each socket shows the code of the cable that belongs in it).
    const shown = wireCodes(s.seed, stage, panel.index), to = Array.from({ length: panel.size }, (_, i) => panel.start + i).find(socket => shown[t.wires.targetOrder[socket]! - panel.start] === code)!;
    return dispatch(s, { type: 'wire', from: panel.start + cable, to });
  }
  if (t.step === 'routing') {
    const r = t.routing, board = book.boards.find(b => b.start === r.start && b.end === r.end); // "IN row 2, OUT row 4"
    assert.ok(board, 'the player\'s board is in the book');
    board!.tiles.forEach((want, tile) => { for (let k = 0; want && k < 4 && tileOpenings(s.tasks.routing.kinds[tile]!, s.tasks.routing.turns[tile]!) !== want; k++) s = dispatch(s, { type: 'rotate', tile }); });
    return dispatch(s, { type: 'engage' });
  }
  if (t.step === 'memory') {
    if (t.memory.playing) return step(s, .2);
    const shown = t.memory.sequence.map(digit => memoryGlyphs(s.seed, stage)[digit - 1]!); // "moon, eye, eye, bars"
    const page = book.memory.find(m => m.stage === stage)!;
    for (const glyph of shown) s = dispatch(s, { type: 'input', value: page.glyphFor.indexOf(glyph) + 1 });
    return s;
  }
  if (t.step === 'pulse') { s = dispatch(s, { type: 'tap' }); return step(s, t.pulse.periodSeconds); }
  if (t.step === 'calm') { const live = coopManual(s) as Extract<CoopManual, { kind: 'calm' }>; return step(dispatch(s, { type: 'breathe', holding: live.inhale }), .1); }
  if (t.step === 'locate') {
    if (s.station !== 'cameras') return dispatch(s, { type: 'station', station: 'cameras' });
    const metres = s.creature.linePosition * 5, band = LOCATE_BANDS.findIndex(b => metres < b.to * 5); // the friend reads the range
    s = dispatch(s, { type: 'input', value: book.locate[band < 0 ? 3 : band]! });
    return dispatch(step(s, config.tasks.locate.spacingSeconds + .1), { type: 'station', station: 'terminal' });
  }
  if (t.step === 'transmit') return dispatch(s, { type: 'transmit' });
  if (t.step === 'final') { for (const digit of book.door) s = dispatch(s, { type: 'input', value: digit }); return dispatch(s, { type: 'transmit' }); }
  return step(s, .2);
}

test('the book solves every puzzle of a co-op run from what the player describes, for any order', () => {
  const orders = new Set<string>();
  for (const seed of [3, 11, 17, 29, 44, 58]) {
    let s = still('coop', seed); const book = coopBook(seed);
    orders.add([1, 2, 3, 4].map(stage => stageSteps(s, stage).join('>')).join(' | '));
    for (let guard = 0; guard < 20_000 && !s.tasks.finalTransmitted && s.status === 'playing'; guard++) s = playStep(s, book);
    assert.equal(s.tasks.finalTransmitted, true, `seed ${seed} reaches the final broadcast`);
    assert.deepEqual(s.tasks.completedStages, [1, 2, 3, 4]);
    assert.equal(wrongs(s), 0, `seed ${seed}: no wrong inputs using only the book`);
  }
  assert.ok(orders.size > 1, 'the puzzle order differs between seeds');
});

test('puzzle order: a per-seed shuffle of each stage, fixed in the tutorial; stages 2 and 4 still end at the transmitter', () => {
  const stages: Record<number, string[]> = { 1: ['faults', 'routing', 'wires'], 2: ['memory', 'pulse'], 3: ['faults', 'locate', 'wires'], 4: ['calm', 'memory'] };
  for (const stage of [1, 2, 3, 4]) {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) { const order = stageSteps({ seed, mode: 'standard' }, stage); assert.deepEqual([...order].sort(), stages[stage]); seen.add(order.join()); }
    assert.ok(seen.size > 1, `stage ${stage} order varies`);
    assert.deepEqual(stageSteps({ seed: 5, mode: 'tutorial' }, stage), stageSteps({ seed: 99, mode: 'tutorial' }, stage), 'the tutorial order is fixed');
  }
  assert.deepEqual(stageSteps({ seed: 5, mode: 'tutorial' }, 1), ['faults', 'wires', 'routing']);
  assert.deepEqual(stageSteps({ seed: 7, mode: 'coop' }, 3), stageSteps({ seed: 7, mode: 'standard' }, 3), 'same seed, same order in co-op and solo');
});

test('every book mapping is reshuffled per seed and stays fixed for a seed', () => {
  const books = [1, 2, 3, 4, 5, 6, 7, 8].map(coopBook);
  for (const pick of [(b: CoopBook) => b.faults.map(f => f.machines), (b: CoopBook) => b.cables.map(c => c.codes), (b: CoopBook) => b.memory.map(m => m.glyphFor), (b: CoopBook) => b.locate, (b: CoopBook) => b.door, (b: CoopBook) => b.boards.map(x => x.tiles)])
    assert.ok(new Set(books.map(b => JSON.stringify(pick(b)))).size > 1);
  assert.deepEqual(coopBook(17), coopBook(17));
  const book = coopBook(23);
  assert.deepEqual(book.faults.map(f => f.stage), [1, 3]); assert.deepEqual(book.memory.map(m => m.stage), [2, 4]);
  for (const c of book.cables) assert.deepEqual([...c.codes].sort(), [0, 1, 2, 3, 4, 5]);
  assert.equal(book.cables.filter(c => c.stage === 3).length, 2, 'stage 3 has two cable panels');
  assert.deepEqual([...book.locate].sort(), [1, 2, 3, 4]);
  assert.equal(new Set(book.boards.map(b => `${b.start}:${b.end}`)).size, book.boards.length, 'each board has its own IN and OUT rows');
  assert.equal(LOCATE_BANDS.map(b => sectorsAt((b.from + b.to) / 2)[0]).join(), 'NEAR,A,B,C', 'the bands follow the radar sectors');
});

test('the player never sees an answer: book codes on the sockets, glyphs for digits, no power reading', () => {
  let s = still('coop', 17);
  while (s.tasks.step !== 'wires') s = playStep(s, coopBook(17));
  const panel = wirePanel(s.tasks.wires), codes = wireCodes(17, s.tasks.stage, panel.index);
  const html = renderToStaticMarkup(createElement(WirePuzzle, { wires: s.tasks.wires, connect: noop, coop: true, codes: (p: number) => wireCodes(17, s.tasks.stage, p) }));
  const labels = [...html.matchAll(/aria-label="Socket ([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(labels, Array.from({ length: panel.size }, (_, socket) => socketCode(codes[s.tasks.wires.targetOrder[panel.start + socket]! - panel.start]!)));
  assert.equal(new Set([...html.matchAll(/data-wire-target="\d+" style="--wire-color:([^"]+)"/g)].map(m => m[1])).size, 1, 'one neutral socket colour');
  const standard = renderToStaticMarkup(createElement(WirePuzzle, { wires: s.tasks.wires, connect: noop }));
  assert.deepEqual([...standard.matchAll(/aria-label="Socket ([^"]+)"/g)].map(m => m[1]).sort(), ['▲', '●', '◆', '■', '✚', '★'].sort(), 'solo sockets still show the matching symbols');
  assert.deepEqual([...new Set(memoryGlyphs(17, 2))].sort(), [0, 1, 2, 3]); assert.equal(MEMORY_GLYPHS.length, 4);
  while (s.tasks.step !== 'routing' && s.tasks.stage === 1) s = playStep(s, coopBook(17));
  if (s.tasks.step === 'routing') {
    const board = (g: GameState) => renderToStaticMarkup(createElement(ConduitTask, { g, send: noop }));
    assert.doesNotMatch(board(s), /CONNECTED · PRESS T|powered|conduit-tile lit/); assert.match(board(s), new RegExp(`IN row ${s.tasks.routing.start + 1}`));
  }
});

test('the live page carries only the breathing pacer, and nothing from the manual enters the trace or a provider request', () => {
  let s = still('coop', 31); const book = coopBook(31);
  for (let guard = 0; guard < 20_000 && s.tasks.step !== 'calm'; guard++) { assert.equal(coopManual(s), null, `no live page on ${s.tasks.step}`); s = playStep(s, book); }
  const pacer = coopManual(s) as Extract<CoopManual, { kind: 'calm' }>;
  assert.equal(pacer.kind, 'calm'); assert.equal(pacer.inhale, calmInhale(s)); assert.equal(pacer.halfTenths, Math.round(s.tasks.calm.halfSeconds * 10));
  for (const g of [still('standard'), createGame(29, 'tutorial'), { ...s, status: 'lost' as const }]) assert.equal(coopManual(g), null);
  const standard = { ...s, mode: 'standard' as const }, trace = sanitizedTrace(s, sensor), json = JSON.stringify(trace);
  assert.equal(/"(manual|sounds|sockets|tiles|answer|targetOrder|kinds|turns|codes|glyph|doorKey)":/i.test(json), false, 'no manual or puzzle-answer fields');
  assert.equal(trace.events.find(e => e.type === 'RUN_STARTED')?.detail, 'coop');
  const request = JSON.stringify(publicDirectorRequest(buildDirectorRequest(s)));
  assert.equal(request.replace('"detail":"coop"', '"detail":"standard"'), JSON.stringify(publicDirectorRequest(buildDirectorRequest(standard))).replace('"detail":"coop"', '"detail":"standard"'));
});

test('co-op voice: talking above a whisper is heard and raises exposure; solo and quiet talk are ignored', () => {
  let s = still('coop', 17); s = dispatch(s, { type: 'quiet' });
  const before = { pressure: s.pressure, heard: s.creature.lastAudibleAt };
  s = dispatch(s, { type: 'voice', loud: true });
  assert.equal(s.voice.loud, true); assert.equal(s.events.at(-1)?.type, 'VOICE_HEARD');
  s = step(s, 2);
  assert.ok(s.pressure > before.pressure, 'talking adds noise even with the equipment isolated'); assert.ok(s.creature.lastAudibleAt > before.heard, 'and counts as audible evidence');
  s = dispatch(s, { type: 'voice', loud: false }); s = dispatch(s, { type: 'voice', loud: true });
  assert.equal(s.events.filter(e => e.type === 'VOICE_HEARD').length, 1, 'VOICE_HEARD is spaced');
  const solo = dispatch(still('standard'), { type: 'voice', loud: true });
  assert.equal(solo.voice.loud, false); assert.ok(!solo.events.some(e => e.type === 'VOICE_HEARD'));
});

test('the friend\'s book renders every page readably from the seed', () => {
  const book = coopBook(17), live = { metres: 42, calm: null };
  const page = (id: typeof BOOK_PAGES[number]) => renderToStaticMarkup(createElement(BookPage, { id, book, live }));
  assert.match(page('contents'), /Rack fault sounds/);
  const faults = page('faults'), first = book.faults[0]!;
  assert.match(faults, /RESEARCH 1/); assert.match(faults, /RESEARCH 3/);
  assert.match(faults, new RegExp(`${FAULT_SOUNDS[0]!.toLowerCase()}</td><td><kbd>${first.machines[0]! + 1}</kbd>`));
  const cables = page('cables'), c = book.cables[0]!;
  assert.match(cables, /RESEARCH 3 · PANEL 2 OF 2/); assert.match(cables, new RegExp(`aria-label="Cable ▲">▲</b><i aria-hidden="true">→</i><strong aria-label="socket ${socketCode(c.codes[0]!)}">`));
  const boards = page('conduit');
  for (const b of book.boards) assert.match(boards, new RegExp(`IN ROW ${b.start + 1} · OUT ROW ${b.end + 1}`));
  assert.match(page('signal'), new RegExp(MEMORY_GLYPHS[0]!.name.toLowerCase()));
  assert.match(page('radar'), /42 m/); assert.match(page('radar'), /Under 35 m/);
  assert.match(page('breathing'), /THE PACER SHOWS HERE/);
  assert.match(page('door'), new RegExp(`Door key ${book.door.join(' ')}`));
});

test('co-op hides the rack key from the player but keeps its timing; L cannot replay it', () => {
  const standard = still('standard'), coop = still('coop');
  assert.equal(listeningTo(standard), 0); assert.equal(listeningTo(coop), null);
  const later = (s: GameState) => step(s, config.tasks.listen.secondsPerMachine * 2.5);
  assert.equal(listeningTo(later(standard)), 2); assert.equal(listeningTo(later(coop)), null);
  const firstFault = (s: GameState) => { let t = 0; while (!s.tasks.faults.active.length) { s = step(s, .1); t += .1; } return t; };
  assert.equal(firstFault(coop), firstFault(standard), 'the silent briefing gap matches the key window');
  let s = step(coop, 10); const listenFrom = s.tasks.faults.listenFrom, events = s.eventSequence;
  s = dispatch(s, { type: 'listen' });
  assert.equal(s.tasks.faults.listenFrom, listenFrom); assert.equal(s.eventSequence, events); assert.match(s.notice, /friend/);
  const keyNames = (g: GameState) => FAULT_SOUNDS.filter(name => renderToStaticMarkup(createElement(FaultTask, { g, send: noop })).includes(name));
  assert.equal(keyNames(standard).length, 1, 'standard shows the playing machine sound');
  assert.deepEqual(keyNames(coop), [], 'co-op shows no key');
  assert.ok(!renderToStaticMarkup(createElement(FaultTask, { g: coop, send: noop })).includes('Listen to the rack again'));
  assert.deepEqual(keyNames(still('standard')), keyNames(standard), 'the prop defaults from the mode');
  assert.deepEqual(FAULT_SOUNDS.filter(name => renderToStaticMarkup(createElement(FaultTask, { g: standard, send: noop, coop: true })).includes(name)), [], 'the prop overrides');
});

