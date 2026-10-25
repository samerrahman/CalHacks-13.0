import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizedTrace, type TraceSnapshot, type TraceSummary } from './client';
import type { PublicEvent } from '../game/state';
import { createGame, dispatch } from '../game/reducer';
import { SensorController } from '../sensing/controller';
import { inferActivity, playerActivity, PlayerWalker, SPOTS, WALK_SPEED, type PlayerStation, type PlayerView } from '../spectate/player';
import { createResearcher } from '../spectate/researcher';
import { OBSTACLES, ROOM } from '../../spacetimedb/src/physicsSim';

const summary = (patch: Partial<TraceSummary> = {}): TraceSummary => ({ time: 30, stage: 1, status: 'playing', equipment: 'on', creatureNode: 'TREELINE', creaturePhase: 'search', linePosition: 18, lineLength: 24, danger: 10, quietChargesRemaining: 3, tactic: 'WAIT', target: 'NONE', proposalSource: 'FALLBACK', sensorSource: 'manual', sensorQuality: 'unknown', trend: 'UNKNOWN', sensorAgeMs: null, ...patch });
let seq = 0;
const ev = (type: string, time: number, detail = ''): PublicEvent => ({ id: `e${++seq}`, seq, time, type, detail });
const snap = (events: PublicEvent[], patch: Partial<TraceSummary> = {}, player?: unknown): TraceSnapshot => ({ seed: 7, mode: 'standard', summary: summary(patch), events, transport: 'local', ...(player === undefined ? {} : { player: player as TraceSnapshot['player'] }) });

test('the same-browser trace carries only the station and an open-panel flag, never while paused', () => {
  const sensor = new SensorController().view();
  let game = createGame(17);
  assert.deepEqual(sanitizedTrace(game, sensor).player, { station: 'terminal', working: false });
  assert.deepEqual(sanitizedTrace(game, sensor, true).player, { station: 'terminal', working: true });
  game = dispatch(game, { type: 'station', station: 'cameras' });
  assert.deepEqual(sanitizedTrace(game, sensor, true).player, { station: 'cameras', working: true });
  assert.equal(sanitizedTrace(dispatch(game, { type: 'pause', paused: true }), sensor, true).player?.working, false);
  assert.equal('player' in sanitizedTrace(game, sensor).summary, false, 'the SpacetimeDB summary is unchanged');
});

test('a shared pose wins over inference, and anything malformed falls back to the events', () => {
  seq = 0;
  const events = [ev('RUN_STARTED', 0), ev('FAULT_CLEARED', 29, '1')];
  assert.deepEqual(playerActivity(snap(events, {}, { station: 'cameras', working: true })), { station: 'cameras', working: true, source: 'shared' });
  assert.deepEqual(playerActivity(snap(events, {}, { station: 'equipment', working: false })), { station: 'equipment', working: false, source: 'shared' }, 'looking at the lever without a task open');
  assert.equal(playerActivity(snap(events, { status: 'lost' }, { station: 'terminal', working: true })).working, false);
  for (const bad of [null, 'terminal', { station: 'hatch', working: true }, { station: 'terminal', working: 'yes' }, { station: 'terminal' }])
    assert.deepEqual(playerActivity(snap(events, {}, bad)), { station: 'terminal', working: true, source: 'inferred' }, JSON.stringify(bad));
});

test('public events place the researcher: terminal inputs work, the lever wins while the power is off', () => {
  seq = 0;
  const start = [ev('RUN_STARTED', 0, 'standard'), ev('FAULT_STARTED', 26), ev('MEMORY_READY', 27)];
  assert.deepEqual(inferActivity(snap(start)), { station: 'terminal', working: false, source: 'inferred' }, 'game-driven events say nothing about the player');
  const typed = [...start, ev('FAULT_CLEARED', 28, '1')];
  assert.equal(inferActivity(snap(typed)).working, true);
  assert.equal(inferActivity(snap(typed, { time: 40 })).working, false, 'idle again a few seconds after the last input');
  const quiet = [...typed, ev('QUIET_ENTERED', 41)];
  assert.deepEqual(inferActivity(snap(quiet, { time: 42, equipment: 'quiet' })), { station: 'equipment', working: true, source: 'inferred' });
  assert.deepEqual(inferActivity(snap(quiet, { time: 55, equipment: 'quiet' })), { station: 'equipment', working: false, source: 'inferred' }, 'waits at the lever while isolated');
  assert.equal(inferActivity(snap([...start, ev('BLACKOUT_STARTED', 30)], { time: 31, equipment: 'blackout' })).station, 'equipment');
  const restored = [...quiet, ev('RESTORED', 60, 'CLEAR')];
  assert.deepEqual(inferActivity(snap(restored, { time: 61 })), { station: 'equipment', working: true, source: 'inferred' });
  assert.deepEqual(inferActivity(snap(restored, { time: 66 })), { station: 'terminal', working: false, source: 'inferred' }, 'back to the terminal after the restore');
  assert.equal(inferActivity(snap([...restored, ev('WIRE_CONNECTED', 61)], { time: 61.5 })).station, 'terminal', 'a later terminal input wins');
  assert.equal(inferActivity(snap(typed, { time: 29, status: 'won' })).working, false);
});

function walk(walker: PlayerWalker, trace: TraceSnapshot, fromMs: number, seconds: number, frameMs = 50): PlayerView[] {
  const views: PlayerView[] = [];
  for (let t = fromMs + frameMs; t <= fromMs + seconds * 1000 + 1e-6; t += frameMs) views.push(walker.at(trace, t)!);
  return views;
}
const clearOf = (v: PlayerView, radius: number) => v.x - radius >= ROOM.min[0] && v.x + radius <= ROOM.max[0] && v.z - radius >= ROOM.min[2] && v.z + radius <= ROOM.max[2]
  && OBSTACLES.every(b => v.x + radius <= b.min[0] || v.x - radius >= b.max[0] || v.z + radius <= b.min[2] || v.z - radius >= b.max[2]);

test('a late joiner sees the researcher already in place; a station change is walked, not teleported', () => {
  seq = 0;
  const walker = new PlayerWalker(), atDesk = snap([ev('RUN_STARTED', 0), ev('FAULT_CLEARED', 29, '1')]);
  const first = walker.at(atDesk, 1000)!;
  assert.deepEqual([first.x, first.z, first.heading, first.walking, first.working], [SPOTS.terminal.x, SPOTS.terminal.z, SPOTS.terminal.heading, false, true]);
  assert.equal(walker.at(atDesk, 1000), first, 'one view per frame for the camera and the map');
  const toLever = snap([...atDesk.events, ev('QUIET_ENTERED', 30)], { time: 30.5, equipment: 'quiet' });
  const views = walk(walker, toLever, 1000, 6);
  assert.equal(views[0]!.walking, true); assert.equal(views[0]!.working, false, 'never works while walking');
  let previous = first;
  for (const v of views) {
    assert.ok(Math.hypot(v.x - previous.x, v.z - previous.z) <= WALK_SPEED * .05 + 1e-9, 'moves at walking speed');
    assert.ok(clearOf(v, .22), `clear of the desk and rack at ${v.x.toFixed(2)}, ${v.z.toFixed(2)}`);
    previous = v;
  }
  const end = views.at(-1)!;
  assert.deepEqual([end.x, end.z, end.walking, end.working], [SPOTS.equipment.x, SPOTS.equipment.z, false, true]);
  assert.ok(Math.abs(Math.sin(end.heading - SPOTS.equipment.heading)) < .01 && Math.cos(end.heading - SPOTS.equipment.heading) > 0, 'faces the lever');
  assert.ok(views.some(v => v.stride > 0), 'the walk cycle advances with distance');
});

test('every station pair is joined by a clear route, the same at any frame rate', () => {
  const stations = Object.keys(SPOTS) as PlayerStation[];
  for (const from of stations) for (const to of stations) {
    if (from === to) continue;
    seq = 0;
    const start = snap([ev('RUN_STARTED', 0)], {}, { station: from, working: false }), next = snap([ev('RUN_STARTED', 0)], {}, { station: to, working: true });
    const fast = new PlayerWalker(), slow = new PlayerWalker();
    fast.at(start, 0); slow.at(start, 0);
    const a = walk(fast, next, 0, 8, 16), b = walk(slow, next, 0, 8, 100);
    assert.ok(a.every(v => clearOf(v, .22)), `${from} → ${to} stays clear`);
    assert.ok(Math.hypot(a.at(-1)!.x - b.at(-1)!.x, a.at(-1)!.z - b.at(-1)!.z) < 1e-9, `${from} → ${to} ends in the same place`);
    assert.deepEqual([a.at(-1)!.x, a.at(-1)!.z, a.at(-1)!.walking, a.at(-1)!.working], [SPOTS[to].x, SPOTS[to].z, false, true], `${from} → ${to} arrives and works`);
  }
});

test('reduced motion and a restarted run place the researcher without walking', () => {
  seq = 0;
  const desk = snap([ev('RUN_STARTED', 0), ev('FAULT_CLEARED', 29)]), lever = snap([...desk.events, ev('QUIET_ENTERED', 30)], { equipment: 'quiet', time: 30.5 });
  const still = new PlayerWalker(); still.at(desk, 0);
  const placed = still.at(lever, 50, true)!;
  assert.deepEqual([placed.x, placed.z, placed.heading, placed.walking], [SPOTS.equipment.x, SPOTS.equipment.z, SPOTS.equipment.heading, false]);
  const walker = new PlayerWalker(); walker.at(lever, 0);
  seq = 0;
  const again = walker.at(snap([ev('RUN_STARTED', 0)], { time: 1 }), 50)!;
  assert.deepEqual([again.x, again.z, again.walking], [SPOTS.terminal.x, SPOTS.terminal.z, false], 'a new run starts at the terminal');
  assert.equal(walker.at(null, 100), null, 'no trace, no researcher');
});

test('the researcher stays low poly and actually changes pose between idle, work and walking', () => {
  const figure = createResearcher();
  assert.ok(figure.triangles <= 300, `${figure.triangles} triangles`);
  let counted = 0;
  figure.root.traverse(o => { const g = (o as { geometry?: { index: { count: number } | null } }).geometry; if (g?.index) counted += g.index.count / 3; });
  assert.equal(counted, figure.triangles);
  const view = (patch: Partial<PlayerView>): PlayerView => ({ station: 'terminal', working: false, source: 'inferred', x: SPOTS.terminal.x, z: SPOTS.terminal.z, heading: Math.PI, walking: false, stride: 0, ...patch });
  const armPitch = () => figure.root.children[0]!.children.map(c => +c.rotation.x.toFixed(3));
  figure.update(view({}), 1, 0, true); const idle = armPitch();
  figure.update(view({ working: true }), 1, 0, true); const typing = armPitch();
  figure.update(view({ walking: true, stride: .25 }), 1, 0, true); const stepping = armPitch();
  assert.notDeepEqual(idle, typing); assert.notDeepEqual(idle, stepping); assert.notDeepEqual(typing, stepping);
  assert.equal(figure.root.position.x, SPOTS.terminal.x); assert.equal(figure.root.rotation.y, Math.PI);
});
