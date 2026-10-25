import assert from 'node:assert/strict';
import test from 'node:test';
import { resumeSensorCapture } from '../src/ui/sensorHandoff';
import type { SensorMode, SensorView } from '../src/sensing/types';

const view = (patch: Partial<SensorView> = {}): SensorView => ({
  source: 'presage', status: 'ready', trend: 'STEADY', quality: 'accepted', hint: 'Live',
  baselineBpm: 72, pulseBpm: 74, ageMs: 0, acceptedSeconds: 30,
  canContinueManual: true, sampleAtMs: 1000, captureSegment: 7, ...patch,
});
function spyController() {
  const calls: { mode: SensorMode; preserveBaseline: boolean | undefined }[] = [];
  return { calls, start: async (mode: SensorMode, preserveBaseline?: boolean) => { calls.push({ mode, preserveBaseline }); } };
}

test('calibrated setup-to-game and camera-panel-to-game handoffs do not start another SDK session', () => {
  const controller = spyController(), calibrated = view();
  resumeSensorCapture(controller, calibrated, 'presage');
  resumeSensorCapture(controller, calibrated, 'presage', true);
  assert.equal(controller.calls.length, 0);
  assert.equal(calibrated.baselineBpm, 72); assert.equal(calibrated.acceptedSeconds, 30);
  assert.equal(calibrated.captureSegment, 7, 'handoff does not discard sample continuity');
});

test('starting and partially calibrated same-mode captures also keep their existing session', () => {
  const controller = spyController();
  for (const source of ['presage', 'simulated'] as const) {
    for (const status of ['starting', 'calibrating', 'ready'] as const) {
      resumeSensorCapture(controller, view({ source, status, baselineBpm: null, acceptedSeconds: 12 }), source, true);
    }
  }
  assert.equal(controller.calls.length, 0, 'handoff neither duplicates camera requests nor resets partial calibration');
});

test('paused or unavailable capture restarts once with the frozen baseline preserved', () => {
  for (const status of ['paused', 'unavailable', 'manual'] as const) {
    const controller = spyController();
    resumeSensorCapture(controller, view({ status, trend: 'UNKNOWN', quality: 'unknown' }), 'presage', true);
    assert.deepEqual(controller.calls, [{ mode: 'presage', preserveBaseline: true }]);
  }
});

test('Stop then Back honors the newly selected manual mode before old Presage teardown completes', () => {
  const controller = spyController();
  // The desired preference changes synchronously; the last visible view may
  // still describe the retiring Presage session during the native stop.
  resumeSensorCapture(controller, view(), 'manual', true);
  resumeSensorCapture(controller, view({ status: 'manual', trend: 'UNKNOWN', quality: 'unknown' }), 'manual', true);
  assert.deepEqual(controller.calls, [
    { mode: 'manual', preserveBaseline: true }, { mode: 'manual', preserveBaseline: true },
  ]);
  assert.equal(controller.calls.some(call => call.mode === 'presage'), false, 'returning to play cannot reverse Stop');
});

test('an actual mode change starts the selected source and forwards explicit baseline policy', () => {
  const controller = spyController();
  resumeSensorCapture(controller, view({ source: 'manual', status: 'manual' }), 'presage', true);
  resumeSensorCapture(controller, view(), 'simulated', false);
  assert.deepEqual(controller.calls, [
    { mode: 'presage', preserveBaseline: true }, { mode: 'simulated', preserveBaseline: false },
  ]);
});
