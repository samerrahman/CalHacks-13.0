import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { config, createGame, dispatch, step } from '../src/game/reducer';
import { buildDirectorRequest } from '../src/game/directorValidation';
import { coopManual, socketCode, type CoopManual } from '../src/game/coop';
import { FAULT_SOUNDS, faultSounds, listeningTo, memoryRounds, startStage, tileOpenings, wirePanel } from '../src/game/tasks';
import type { GameState } from '../src/game/state';
import type { SensorView } from '../src/sensing/types';
import { publicDirectorRequest } from '../src/integrations/contracts';
import { sanitizedTrace } from '../src/integrations/client';
import WirePuzzle from '../src/ui/WirePuzzle';

// ThinkingTasks imports its stylesheet; stub CSS so the real components render in Node.
registerHooks({ resolve: (specifier, context, next) => specifier.endsWith('.css') ? { url: 'data:text/javascript,', shortCircuit: true } : next(specifier, context) });
const { ConduitTask, FaultTask } = await import('../src/ui/ThinkingTasks');
const { ManualPage } = await import('../src/ui/CoopManual');

const sensor: SensorView = { source: 'manual', status: 'manual', trend: 'UNKNOWN', quality: 'unknown', hint: '', baselineBpm: null, pulseBpm: null, ageMs: null, sampleAtMs: null, captureSegment: 0, acceptedSeconds: 0, canContinueManual: true };
const noop = () => {};
function still(mode: GameState['mode'], seed = 17): GameState { const s = createGame(seed, mode); s.creature.nextMoveAt = 1e6; s.blackout.nextAt = 1e6; return s; }
/** Clears faults with the key the player hears (faultSounds) looked up in the friend's manual. */
function clearFaults(s: GameState): GameState {
  while (s.tasks.step === 'faults') {
    const machine = s.tasks.faults.active[0];
    if (machine === undefined) { s = step(s, .2); continue; }
    const manual = coopManual(s) as Extract<CoopManual, { kind: 'faults' }>, heard = faultSounds(s)[machine]!;
    s = dispatch(s, { type: 'input', value: manual.sounds.indexOf(heard) + 1 });
  }
  return s;
}
function patchByManual(s: GameState): GameState {
  while (s.tasks.step === 'wires') {
    const manual = coopManual(s) as Extract<CoopManual, { kind: 'wires' }>, panel = wirePanel(s.tasks.wires);
    assert.equal(manual.kind, 'wires'); assert.equal(manual.panel, panel.index); assert.equal(manual.sockets.length, panel.size);
    manual.sockets.forEach((socket, cable) => { s = dispatch(s, { type: 'wire', from: panel.start + cable, to: panel.start + socket }); });
  }
  return s;
}
const strip = (s: GameState) => ({ ...s, mode: 'x', notice: '', events: s.events.map(e => e.type === 'RUN_STARTED' ? { ...e, detail: '' } : e) });

test('co-op plays the standard rules: same seed and inputs give the same run apart from mode and notices', () => {
  const play = (mode: 'standard' | 'coop') => {
    let s = createGame(29, mode);
    while (s.time < 70 && s.status === 'playing') {
      const t = s.tasks;
      if (t.step === 'faults' && t.faults.active.length) s = dispatch(s, { type: 'input', value: t.faults.active[0]! + 1 });
      else if (t.step === 'wires') { const from = t.wires.connections.indexOf(-1); s = dispatch(s, { type: 'wire', from, to: t.wires.targetOrder.indexOf(from) }); }
      s = step(s, .25);
    }
    return s;
  };
  const standard = play('standard'), coop = play('coop');
  assert.ok(standard.events.some(e => e.type === 'MONSTER_STEP') && standard.tasks.step === 'routing', 'the comparison covers movement, faults and cables');
  assert.deepEqual(strip(coop), strip(standard));
  assert.equal(coop.events[0]!.detail, 'coop');
  for (const s of [standard, createGame(29, 'tutorial'), still('standard')]) assert.equal(coopManual(s), null, 'nothing outside co-op');
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

test('co-op sockets carry neutral codes, and the conduit shows no power or joined reading', () => {
  const s = clearFaults(still('coop')), panel = wirePanel(s.tasks.wires);
  const html = (coop: boolean) => renderToStaticMarkup(createElement(WirePuzzle, { wires: s.tasks.wires, connect: noop, coop }));
  const socketLabels = (markup: string) => [...markup.matchAll(/aria-label="Socket ([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(socketLabels(html(true)), Array.from({ length: panel.size }, (_, i) => socketCode(i)));
  assert.deepEqual([...socketLabels(html(false))].sort(), ['▲', '●', '◆', '■', '✚', '★'].sort(), 'standard sockets still show the matching symbols');
  assert.equal(new Set([...html(true).matchAll(/data-wire-target="\d+" style="--wire-color:([^"]+)"/g)].map(m => m[1])).size, 1, 'one neutral socket colour');
  let solved = patchByManual(s);
  assert.equal(solved.tasks.step, 'routing');
  const manual = coopManual(solved) as Extract<CoopManual, { kind: 'routing' }>;
  manual.tiles.forEach((want, tile) => { for (let k = 0; want && k < 4 && tileOpenings(solved.tasks.routing.kinds[tile]!, solved.tasks.routing.turns[tile]!) !== want; k++) solved = dispatch(solved, { type: 'rotate', tile }); });
  const board = (g: GameState) => renderToStaticMarkup(createElement(ConduitTask, { g, send: noop }));
  assert.match(board({ ...solved, mode: 'standard' }), /CONNECTED · PRESS T/); assert.match(board({ ...solved, mode: 'standard' }), /powered/);
  assert.doesNotMatch(board(solved), /CONNECTED · PRESS T|powered|joined|conduit-tile lit/);
});

test('coopManual gives exactly the key for the live task and solves stage 1 without private state', () => {
  let s = still('coop', 31);
  assert.deepEqual(coopManual(s), { kind: 'faults', stage: 1, sounds: faultSounds(s) });
  s = clearFaults(s); assert.equal(s.events.filter(e => e.type === 'WRONG_INPUT').length, 0);
  s = patchByManual(s); assert.equal(s.events.filter(e => e.type === 'WRONG_INPUT').length, 0);
  const manual = coopManual(s) as Extract<CoopManual, { kind: 'routing' }>;
  assert.equal(manual.kind, 'routing'); assert.equal(manual.tiles.length, manual.size ** 2);
  assert.equal(manual.tiles.filter(Boolean).length, s.tasks.routing.answer.filter(turns => turns >= 0).length, 'route tiles only; decoys read 0');
  manual.tiles.forEach((want, tile) => { for (let k = 0; want && k < 4 && tileOpenings(s.tasks.routing.kinds[tile]!, s.tasks.routing.turns[tile]!) !== want; k++) s = dispatch(s, { type: 'rotate', tile }); });
  s = dispatch(s, { type: 'engage' });
  assert.deepEqual(s.tasks.completedStages, [1]); assert.equal(s.tasks.stage, 2);
  assert.equal(coopManual(s), null, 'memory has no manual page');
  for (let round = 0; round < memoryRounds(s).rounds; round++) { while (s.tasks.memory.playing) s = step(s, .2); for (const value of [...s.tasks.memory.sequence]) s = dispatch(s, { type: 'input', value }); }
  assert.equal(s.tasks.step, 'pulse'); assert.equal(coopManual(s), null, 'heartbeat mask has no manual page');
  const three = structuredClone(s); startStage(three, 3);
  assert.deepEqual(coopManual(three), { kind: 'faults', stage: 3, sounds: faultSounds(three) });
  const keys = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(seed => { const g = still('coop', seed); const k = (coopManual(g) as Extract<CoopManual, { kind: 'faults' }>).sounds.join(); startStage(g, 3); return k + '|' + (coopManual(g) as Extract<CoopManual, { kind: 'faults' }>).sounds.join(); }));
  assert.ok(keys.size > 1, 'the key changes with the seed');
  const twelve = patchByManual(clearFaults(three)); assert.equal(twelve.tasks.step, 'locate'); assert.equal(twelve.events.filter(e => e.type === 'WRONG_INPUT').length, 0, 'stage 3 needs both panels from the manual');
  assert.equal(coopManual(twelve), null, 'locate has no manual page');
  const four = structuredClone(twelve); startStage(four, 4); assert.equal(coopManual(four), null);
  const final = structuredClone(twelve); startStage(final, 5); assert.equal(coopManual(final), null);
  assert.equal(coopManual({ ...still('coop'), status: 'lost' }), null, 'nothing once the run ends');
});

test('the manual never enters the sanitized trace or a provider request', () => {
  const coop = patchByManual(clearFaults(still('coop'))), standard = { ...coop, mode: 'standard' as const };
  assert.ok(coopManual(coop));
  const trace = sanitizedTrace(coop, sensor), json = JSON.stringify(trace);
  assert.deepEqual({ ...trace, mode: 'x', events: trace.events.map(e => ({ ...e, detail: e.type === 'RUN_STARTED' ? '' : e.detail })) }, { ...sanitizedTrace(standard, sensor), mode: 'x', events: sanitizedTrace(standard, sensor).events.map(e => ({ ...e, detail: e.type === 'RUN_STARTED' ? '' : e.detail })) });
  assert.equal(/"(manual|sounds|sockets|tiles|answer|targetOrder|kinds|turns)":/i.test(json), false, 'no manual or puzzle-answer fields');
  assert.equal(trace.events.find(e => e.type === 'RUN_STARTED')?.detail, 'coop', 'the mode passes the public detail whitelist');
  const request = JSON.stringify(publicDirectorRequest(buildDirectorRequest(coop)));
  assert.equal(request.replace('"detail":"coop"', '"detail":"standard"'), JSON.stringify(publicDirectorRequest(buildDirectorRequest(standard))).replace('"detail":"coop"', '"detail":"standard"'));
  assert.equal(/"(manual|sounds|sockets|tiles|answer|targetOrder)":/i.test(request), false);
});

test('the friend\'s manual page renders each key readably', () => {
  const faults = renderToStaticMarkup(createElement(ManualPage, { manual: { kind: 'faults', stage: 1, sounds: [2, 0, 3, 1] } }));
  assert.match(faults, /low thumping<\/td><td><kbd>2<\/kbd>/); assert.match(faults, /fast ticking<\/td><td><kbd>1<\/kbd>/);
  const wires = renderToStaticMarkup(createElement(ManualPage, { manual: { kind: 'wires', stage: 3, panel: 1, panels: 2, sockets: [3, 0, 1, 2, 5, 4] } }));
  assert.match(wires, /Panel 2 of 2/); assert.match(wires, /aria-label="Cable ▲">▲<\/b><i aria-hidden="true">→<\/i><strong aria-label="socket D">D/);
  const routing = renderToStaticMarkup(createElement(ManualPage, { manual: { kind: 'routing', stage: 1, size: 2, start: 0, end: 1, tiles: [10, 12, 0, 5] } }));
  assert.match(routing, /Row 1, column 1: joins right and left/); assert.match(routing, /Row 2, column 1: off the route/); assert.match(routing, /IN ▸/);
  assert.match(renderToStaticMarkup(createElement(ManualPage, { manual: null })), /No page right now/);
});
