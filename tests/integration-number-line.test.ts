import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/game/config';
import { createGame } from '../src/game/reducer';
import { buildDirectorRequest } from '../src/game/directorValidation';
import type { DirectorRequest } from '../src/game/state';
import { publicDirectorRequest, publicEvent, TRACE_SCHEMA_VERSION } from '../src/integrations/contracts';
import { sanitizedTrace } from '../src/integrations/client';
import { SensorController } from '../src/sensing/controller';

test('public number-line observations have canonical finite bounds and exclude clocks, wire answers and physiology', () => {
 const request = buildDirectorRequest(createGame(17));
 const raw = { ...request, privateWires: 'PRIVATE_WIRE_PATTERN', observations: { ...request.observations, wireEndpoints: 'PRIVATE_WIRE_PATTERN', pulseBpm: 'PRIVATE_PULSE', sensorDistance: 18, sensorSampleAt: 4321, movementRng: 9876 } };
 const safe = publicDirectorRequest(raw);
 assert.equal(safe.observations.linePosition, config.line.start);
 assert.equal(safe.observations.lineLength, config.line.length);
 assert.equal(safe.observations.danger, config.danger.base);
 assert.equal(safe.observations.quietChargesRemaining, config.shutdown.charges);
 for (const forbidden of ['PRIVATE_', 'wireEndpoints', 'pulseBpm', 'sensorDistance', 'sensorSampleAt', 'movementRng']) assert.equal(JSON.stringify(safe).includes(forbidden), false);
 for (const [key, value] of [ ['linePosition', -1], ['linePosition', config.line.length + 1], ['linePosition', 1.5], ['lineLength', config.line.length + 1], ['danger', 101], ['danger', NaN], ['quietChargesRemaining', config.shutdown.charges + 1], ['quietChargesRemaining', .5] ] as const) {
  assert.throws(() => publicDirectorRequest({ ...request, observations: { ...request.observations, [key]: value } } as DirectorRequest), `${key}=${value}`);
 }
 assert.deepEqual(publicDirectorRequest(safe), safe);
});

test('public step events retain only bounded arithmetically consistent movement, with no puzzle data', () => {
 const event = (type: string, detail: string) => ({ id: 'e1', seq: 1, time: 1, type, detail });
 for (const detail of ['from=18 to=16 step=-2', 'from=0 to=3 step=3', 'from=24 to=24 step=0']) assert.equal(publicEvent(event('MONSTER_STEP', detail)).detail, detail);
 for (const detail of ['from=18 to=0 step=-2', 'from=0 to=4 step=4', 'from=25 to=24 step=-1', 'from=-1 to=0 step=1', 'from=18 to=16 step=-2 SECRET', 'wire=RED:BLUE']) assert.equal(publicEvent(event('MONSTER_STEP', detail)).detail, '');
 for (const type of ['WIRE_CONNECTED', 'QUIET_EXHAUSTED', 'QUIET_COOLDOWN', 'TIMEOUT']) {
  assert.deepEqual(publicEvent(event(type, 'SECRET wire=RED:BLUE pulse=88')), event(type, ''));
 }
 assert.equal(publicEvent(event('WRONG_INPUT', 'WIRE')).detail, 'WIRE');
 assert.equal(publicEvent(event('WRONG_INPUT', 'WIRE red-to-blue')).detail, '');
});

test('judge trace exposes the same coarse gameplay state without detector sample clocks or wire solutions', () => {
 const state = createGame(17);
 const sensor = new SensorController();
 const trace = sanitizedTrace(state, { ...sensor.view(), pulseBpm: 80, sampleAtMs: 987654 });
 assert.equal(trace.summary.linePosition, state.creature.linePosition);
 assert.equal(trace.summary.lineLength, config.line.length);
 assert.equal(trace.summary.danger, Math.round(state.danger));
 assert.equal(trace.summary.quietChargesRemaining, state.shutdown.chargesRemaining);
 for (const forbidden of ['pulseBpm', 'sampleAtMs', 'sensorDistance', 'sensorSampleAt', 'movementRng', 'wireEndpoints']) assert.equal(JSON.stringify(trace).includes(forbidden), false);
 assert.equal(TRACE_SCHEMA_VERSION, 'hush-v2', 'new trace fields require an explicit compatible deployment');
});
