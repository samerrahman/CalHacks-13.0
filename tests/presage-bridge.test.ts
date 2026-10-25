import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

type Packet = { kind: string; [key: string]: unknown };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const METRIC_TYPE = { CHEST_BREATHING: 0, ABDOMEN_BREATHING: 1, BREATHING_RATE: 2, EDA_TRACE: 10, BLINKING: 12, TALKING: 13, EXPRESSIONS: 14, PULSE_RATE: 15, ARTERIAL_PRESSURE_TRACE: 16, HRV: 17, PULSE_RATE_STRICT: 18, BREATHING_RATE_STRICT: 19 };
async function harness(env: Record<string, string> = {}) {
  const ipcMain = new EventEmitter(), instances: FakeSDK[] = [], history: string[] = [];
  let delayStop: Promise<void> = Promise.resolve();
  class FakeSDK {
    callbacks = new Map<string, (...args: unknown[]) => void>();
    frameFailure: unknown = null;
    frames = 0;
    constructor(readonly options: unknown) { instances.push(this); history.push('construct'); }
    on(name: string, callback: (...args: unknown[]) => void) { this.callbacks.set(name, callback); }
    emit(name: string, ...args: unknown[]) { this.callbacks.get(name)?.(...args); }
    useCustomInput() { history.push('input'); }
    start() { history.push('start'); }
    stopAsync() { history.push('stop'); return delayStop; }
    async destroy() { history.push('destroy'); }
    sendFrame() { this.frames++; if (this.frameFailure) throw this.frameFailure; return true; }
  }
  const fixture = { ipcMain, require: (name: string) => name.endsWith('/main') ? { bindSmartSpectraIpc() {} } : { SmartSpectraSDK: FakeSDK, MetricType: METRIC_TYPE } };
  const result = await build({ entryPoints: ['electron/presageAdapter.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent', plugins: [{ name: 'isolated-native-fixture', setup(builder) {
    builder.onResolve({ filter: /^(electron|node:module)$/ }, args => ({ path: args.path, namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path === 'electron' ? 'export const ipcMain=globalThis.fixture.ipcMain' : 'export const createRequire=()=>globalThis.fixture.require', loader: 'js' }));
  } }] });
  const module = { exports: {} as { bindPresage(window: unknown): () => void } };
  runInNewContext(result.outputFiles[0]!.text, { module, exports: module.exports, fixture, process: { env: { PRESAGE_API_KEY: 'fixture-secret', ...env } }, URL, Uint8Array, ArrayBuffer });
  const webContents = { mainFrame: {} }, window = { webContents };
  const unbind = module.exports.bindPresage(window);
  class Port extends EventEmitter { messages: Packet[] = []; closed = false; postMessage(value: Packet) { this.messages.push(value); } start() {} close() { if (!this.closed) { this.closed = true; this.emit('close'); } } }
  const attach = () => { const port = new Port(); ipcMain.emit('hush:sensor-attach', { sender: webContents, senderFrame: webContents.mainFrame, ports: [port] }); return port; };
  const port = attach();
  return { port, attach, instances, history, send: (packet: Packet) => port.emit('message', { data: packet }), unbind, delay: (value: Promise<void>) => { delayStop = value; } };
}

test('native replacement waits for stop and destroy before constructor; retired callbacks cannot overwrite new session', async () => {
  const h = await harness();
  try {
    h.send({ kind: 'configure' }); h.send({ kind: 'start', replyId: 1 }); await flush();
    assert.equal(h.instances.length, 1); const first = h.instances[0]!;
    let release!: () => void; h.delay(new Promise(resolve => { release = resolve; }));
    h.send({ kind: 'configure' }); h.send({ kind: 'start', replyId: 2 }); await flush();
    assert.equal(h.instances.length, 1, 'no second constructor while previous native SDK is draining');
    const count = h.port.messages.length;
    first.emit('metrics', new Uint8Array([1]), 123); first.emit('error', 5, 'old network failure', false);
    assert.equal(h.port.messages.length, count);
    release(); await flush();
    assert.equal(h.instances.length, 2);
    assert.ok(h.history.indexOf('destroy') < h.history.lastIndexOf('construct'));
    assert.deepEqual(JSON.parse(JSON.stringify(h.instances[1]!.options)), { apiKey: 'fixture-secret', requestedMetrics: [15, 2, 0, 1, 17, 12, 13, 14, 10, 16], enableTelemetry: false });
  } finally { h.unbind(); await flush(); }
});

test('main requests all ten standard metrics, never strict variants; PRESAGE_METRICS=core restores pulse + breathing only', async () => {
  for (const [env, expected] of [[{}, [15, 2, 0, 1, 17, 12, 13, 14, 10, 16]], [{ PRESAGE_METRICS: 'core' }, [15, 2]]] as const) {
    const h = await harness(env);
    try {
      h.send({ kind: 'configure', requestedMetrics: [18, 19] }); await flush();
      const options = JSON.parse(JSON.stringify(h.instances[0]!.options)) as { requestedMetrics: number[] };
      assert.deepEqual(options.requestedMetrics, expected, 'renderer-supplied metrics are ignored');
      assert.ok(!options.requestedMetrics.includes(18) && !options.requestedMetrics.includes(19));
    } finally { h.unbind(); await flush(); }
  }
});

test('bridge forwards real frame/metrics events and first sanitized native failure without invalid-state masking', async () => {
  const h = await harness();
  try {
    h.send({ kind: 'configure' }); h.send({ kind: 'start', replyId: 1 }); await flush();
    const sdk = h.instances[0]!;
    sdk.emit('frameSentThrough', true, 123_000); sdk.emit('frameSentThrough', false, 124_000);
    assert.equal(h.port.messages.filter(packet => packet.kind === 'frameSentThrough').length, 2);
    sdk.emit('error', 5, 'Model download failed: fixture-secret https://model.example/a?token=secret', false);
    sdk.emit('error', 1, 'Not in a valid state', false);
    const errors = h.port.messages.filter(packet => packet.kind === 'error');
    assert.equal(errors.length, 1); assert.equal(errors[0]!.code, 5);
    assert.match(String(errors[0]!.message), /Model download failed/);
    assert.ok(!String(errors[0]!.message).includes('fixture-secret')); assert.ok(!String(errors[0]!.message).includes('token=secret'));
  } finally { h.unbind(); await flush(); }
});

test('replacement on a new renderer port retires old SDK before constructing, even before old port closes', async () => {
  const h = await harness();
  try {
    h.send({ kind: 'configure' }); h.send({ kind: 'start', replyId: 1 }); await flush();
    let release!: () => void; h.delay(new Promise(resolve => { release = resolve; }));
    const next = h.attach(); next.emit('message', { data: { kind: 'configure' } }); next.emit('message', { data: { kind: 'start', replyId: 2 } });
    await flush(); assert.equal(h.instances.length, 1);
    release(); await flush(); assert.equal(h.instances.length, 2);
    assert.ok(h.history.indexOf('destroy') < h.history.lastIndexOf('construct'));
    const count = h.port.messages.length; h.instances[0]!.emit('processingStatus', 5);
    assert.equal(h.port.messages.length, count);
  } finally { h.unbind(); await flush(); }
});

test('transient native frame timestamp rejection drops only that frame; actual processing error still terminates', async () => {
  const h = await harness();
  try {
    h.send({ kind: 'configure' }); h.send({ kind: 'start', replyId: 1 }); await flush();
    const sdk = h.instances[0]!;
    const frame = (timestampUs: number) => ({ kind: 'frame', buffer: new ArrayBuffer(4), width: 1, height: 1, stride: 4, pixelFormat: 2, timestampUs });
    sdk.frameFailure = Object.assign(new Error('Frame timestamp gap'), { code: 11 }); h.send(frame(1000));
    sdk.frameFailure = Object.assign(new Error('Nonmonotonic frame timestamp'), { code: 10 }); h.send(frame(2000));
    sdk.frameFailure = null; h.send(frame(3000));
    assert.equal(sdk.frames, 3, 'capture remains active for the next valid frame');
    assert.equal(h.port.messages.filter(packet => packet.kind === 'error').length, 0);
    assert.equal(h.port.messages.filter(packet => packet.kind === 'frameSentThrough' && packet.sent === false).length, 2);
    sdk.frameFailure = Object.assign(new Error('Native processing failed'), { code: 8 }); h.send(frame(4000)); h.send(frame(5000));
    assert.equal(sdk.frames, 4, 'terminal errors still stop subsequent frame submission');
    assert.equal(h.port.messages.find(packet => packet.kind === 'error')?.code, 8);
  } finally { h.unbind(); await flush(); }
});
