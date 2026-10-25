import { ipcMain, type BrowserWindow, type MessagePortMain } from 'electron';
import { createRequire } from 'node:module';
import type { SmartSpectraSDK as NativeSDK } from '@smartspectra/node-sdk';
import { sanitizeSensorError } from '../src/sensing/sensorError';
import { CORE_METRICS, REQUESTED_METRICS } from '../src/sensing/metricPolicy';

const require = createRequire(import.meta.url);
let retiring: Promise<unknown> = Promise.resolve();

/** Verified 3.4.0 renderer protocol. Equivalent to the vendor sample's main
 * bridge, restricted to camera input and the ten standard metrics in
 * REQUESTED_METRICS (PRESAGE_METRICS=core: pulse and breathing rate only).
 * Main alone chooses the request. Credentials are injected here, never
 * transported into the renderer or browser bundle. */
export function bindPresage(window: BrowserWindow): () => void {
  if (process.env.PRESAGE_API_KEY) {
    // The documented host binding prepares the SDK's per-app native cache.
    // Its standard attach channel is never exposed by our preload. Camera data
    // uses the restricted port below so keys can remain entirely in main.
    try { const host = require('@smartspectra/node-sdk/main') as typeof import('@smartspectra/node-sdk/main'); host.bindSmartSpectraIpc(window, { logger: () => undefined }); } catch { /* status/start report native unavailability */ }
  }
  const ports = new Set<MessagePortMain>();
  let retireActivePort: (() => void) | null = null;
  const listener = (event: Electron.IpcMainEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return;
    const port = event.ports[0];
    if (!port) return;
    ports.add(port);
    let sdk: NativeSDK | null = null;
    let lastTimestamp = 0;
    let stopped = true;
    let generation = 0;
    let closed = false;
    let configuring: Promise<void> = Promise.resolve();
    let firstError: string | null = null;
    const post = (value: unknown) => { try { port.postMessage(value); } catch { /* window closed */ } };
    const ack = (replyId: unknown, ok = true, message = '') => post({ kind: 'ack', replyId, ok, payload: null, error: ok ? undefined : { code: 0, message, retryable: false } });
    const fail = (code: number, error: unknown, retryable = false) => {
      if (closed || firstError !== null) return;
      stopped = true;
      firstError = sanitizeSensorError(error, process.env.PRESAGE_API_KEY);
      post({ kind: 'error', code, message: firstError, retryable });
    };
    const retire = () => {
      const prior = sdk; sdk = null; stopped = true;
      if (prior) retiring = retiring.then(async () => { try { await prior.stopAsync(); } finally { await prior.destroy(); } }).catch(() => undefined);
    };
    const invalidate = () => { generation++; retire(); };
    port.on('message', (event: Electron.MessageEvent) => {
      const d = event.data;
      if (!d || typeof d.kind !== 'string') return;
      try {
        if (d.kind === 'configure') {
          // Renderer SDK restarts create a fresh MessagePort. Invalidate an old
          // port even if its asynchronous close has not reached main yet.
          if (retireActivePort !== invalidate) retireActivePort?.();
          retireActivePort = invalidate;
          const token = ++generation;
          retire();
          firstError = null;
          // Native state is process-global. Await complete destruction before
          // constructing the next SDK, not merely before calling its start().
          configuring = retiring.then(() => {
            if (closed || token !== generation) return;
            if (!process.env.PRESAGE_API_KEY) throw new Error('PRESAGE_API_KEY is not configured in Electron main.');
            const native = require('@smartspectra/node-sdk') as typeof import('@smartspectra/node-sdk');
            const requestedMetrics = (process.env.PRESAGE_METRICS === 'core' ? CORE_METRICS : REQUESTED_METRICS).map(name => native.MetricType[name]);
            const target = new native.SmartSpectraSDK({ apiKey: process.env.PRESAGE_API_KEY, requestedMetrics, enableTelemetry: false });
            sdk = target;
            const current = () => !closed && token === generation && target === sdk;
            target.on('processingStatus', status => { if (current()) post({ kind: 'processingStatus', status }); });
            target.on('validationStatus', (code, timestampUs, hint) => { if (current()) post({ kind: 'validationStatus', code, timestampUs, hint }); });
            target.on('metrics', (buf, timestampUs) => { if (current()) post({ kind: 'metrics', buffer: Uint8Array.from(buf).buffer, timestampUs }); });
            target.on('frameSentThrough', (sent, timestampUs) => { if (current()) post({ kind: 'frameSentThrough', sent, timestampUs }); });
            target.on('error', (code, message, retryable) => { if (current()) fail(code, message, retryable); });
          }).catch(error => { if (!closed && token === generation) fail(0, error); });
          return;
        }
        if (d.kind === 'start') {
          const token = generation;
          void configuring.then(() => {
            if (closed || token !== generation || !sdk) throw new Error(firstError ?? 'Capture not configured');
            if (firstError) throw new Error(firstError);
            sdk.useCustomInput(); sdk.start(); stopped = firstError !== null; lastTimestamp = 0; ack(d.replyId, !firstError, firstError ?? '');
          }).catch(error => { if (!closed && token === generation) { fail(0, error); ack(d.replyId, false, firstError ?? sanitizeSensorError(error, process.env.PRESAGE_API_KEY)); } });
        } else if (d.kind === 'stop') {
          stopped = true;
          void configuring.then(() => sdk?.stopAsync()).then(() => ack(d.replyId)).catch(error => ack(d.replyId, false, firstError ?? sanitizeSensorError(error, process.env.PRESAGE_API_KEY)));
        } else if (d.kind === 'destroy') { generation++; closed = true; retire(); port.close(); }
        else if (d.kind === 'frame' && sdk && !stopped) {
          // MediaStream SDK emits RGBA frames. Do not permit arbitrary buffers,
          // pixel formats, dimensions, timestamps, files or shell access.
          if (!(d.buffer instanceof ArrayBuffer) || !Number.isInteger(d.width) || !Number.isInteger(d.height) || d.width < 1 || d.width > 1920 || d.height < 1 || d.height > 1080 || d.stride !== d.width * 4 || d.pixelFormat !== 2 || d.buffer.byteLength !== d.stride * d.height || !Number.isSafeInteger(d.timestampUs) || d.timestampUs <= lastTimestamp) { post({ kind: 'frameSentThrough', sent: false, timestampUs: Number.isSafeInteger(d.timestampUs) ? d.timestampUs : 0 }); return; }
          lastTimestamp = d.timestampUs;
          try { sdk.sendFrame(new Uint8Array(d.buffer), d.width, d.height, d.stride, 2, d.timestampUs); } catch (error) {
            post({ kind: 'frameSentThrough', sent: false, timestampUs: d.timestampUs });
            const code = typeof (error as { code?: number })?.code === 'number' ? (error as { code: number }).code : 0;
            // Vendor 3.4 main bridge drops transient frame ordering failures.
            // One delayed frame must not close capture and restart both metric
            // analysis windows. Native terminal error events still use fail().
            if (code !== 10 && code !== 11) fail(code, error);
          }
        } else if (typeof d.replyId === 'number') ack(d.replyId, false, 'Unsupported sensor operation');
      } catch (error) { fail(0, error); ack(d.replyId, false, firstError ?? 'Sensor unavailable'); }
    });
    port.on('close', () => { ports.delete(port); closed = true; invalidate(); if (retireActivePort === invalidate) retireActivePort = null; });
    port.start();
  };
  ipcMain.on('lock-in:sensor-attach', listener);
  return () => { ipcMain.removeListener('lock-in:sensor-attach', listener); for (const port of ports) port.close(); };
}
