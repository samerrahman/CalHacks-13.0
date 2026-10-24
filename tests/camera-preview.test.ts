import assert from 'node:assert/strict';
import test from 'node:test';
import { SensorController } from '../src/sensing/controller';

function globals(getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>, desktop = true) {
 const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
 const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
 Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia } } });
 Object.defineProperty(globalThis, 'window', { configurable: true, value: desktop ? { hush: { status: async () => ({ presage: true, reasons: [] }) } } : {} });
 return () => { if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); else Reflect.deleteProperty(globalThis, 'navigator'); if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor); else Reflect.deleteProperty(globalThis, 'window'); };
}
function camera() {
 let stops = 0;
 const track = { stop() { stops++; }, addEventListener() {} } as unknown as MediaStreamTrack;
 const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
 return { stream, get stops() { return stops; } };
}

test('selected camera preview uses the exact consenting stream, then clears and releases it if SDK startup fails', async () => {
 const device = camera(); let constraints: MediaStreamConstraints | null = null, calls = 0;
 const restore = globals(async value => { constraints = value; calls++; return device.stream; });
 const controller = new SensorController(), previews: (MediaStream | null)[] = [];
 const unsubscribe = controller.subscribePreview(value => previews.push(value));
 try {
  controller.setCameraDevice('test-usb-camera');
  await controller.start('presage');
  assert.equal(calls, 1, 'preview never opens a second camera capture');
  assert.equal((constraints as unknown as MediaStreamConstraints).audio, false);
  assert.deepEqual(((constraints as unknown as MediaStreamConstraints).video as MediaTrackConstraints).deviceId, { exact: 'test-usb-camera' });
  assert.ok(previews.includes(device.stream), 'preview receives the captured stream itself');
  assert.equal(previews.at(-1), null);
  assert.equal(device.stops, 1, 'missing native bridge releases the real capture resource');
  assert.equal(controller.view().status, 'unavailable');
  assert.equal(controller.view().trend, 'UNKNOWN');
 } finally { unsubscribe(); await controller.dispose(); restore(); }
});

test('capture resolved after disposal is immediately stopped and never published as a preview', async () => {
 const device = camera(); let resolveStream!: (stream: MediaStream) => void, notifyRequested!: () => void;
 const requested = new Promise<void>(resolve => { notifyRequested = resolve; });
 const restore = globals(() => { notifyRequested(); return new Promise(resolve => { resolveStream = resolve; }); });
 const controller = new SensorController(), previews: (MediaStream | null)[] = [];
 controller.subscribePreview(value => previews.push(value));
 try {
  const starting = controller.start('presage'); await requested;
  await controller.dispose(); resolveStream(device.stream); await starting;
  assert.equal(device.stops, 1);
  assert.ok(previews.every(value => value === null), 'no late camera image is exposed after disposal');
 } finally { await controller.dispose(); restore(); }
});

test('browser-only Presage selection reports unavailable without opening any camera', async () => {
 let calls = 0;
 const restore = globals(async () => { calls++; return camera().stream; }, false);
 const controller = new SensorController(), previews: (MediaStream | null)[] = [];
 controller.subscribePreview(value => previews.push(value));
 try {
  await controller.start('presage');
  assert.equal(calls, 0); assert.ok(previews.every(value => value === null));
  assert.equal(controller.view().status, 'unavailable');
  assert.match(controller.view().hint, /Electron/);
 } finally { await controller.dispose(); restore(); }
});
