import { ipcMain, type BrowserWindow, type MessagePortMain } from 'electron';
import { createRequire } from 'node:module';
import type { SmartSpectraSDK as NativeSDK } from '@smartspectra/node-sdk';

const require = createRequire(import.meta.url);
let retiring: Promise<unknown> = Promise.resolve();

/** Verified 3.4.0 renderer protocol. Equivalent to the vendor sample's main
 * bridge, restricted to camera input and cardiac metrics. Credentials are
 * injected here, never transported into the renderer or browser bundle. */
export function bindPresage(window: BrowserWindow): () => void {
  if (process.env.PRESAGE_API_KEY) {
    // The documented host binding prepares the SDK's per-app native cache.
    // Its standard attach channel is never exposed by our preload. Camera data
    // uses the restricted port below so keys can remain entirely in main.
    try { const host = require('@smartspectra/node-sdk/main') as typeof import('@smartspectra/node-sdk/main'); host.bindSmartSpectraIpc(window, { logger: () => undefined }); } catch { /* status/start report native unavailability */ }
  }
  const ports = new Set<MessagePortMain>();
  const listener = (event: Electron.IpcMainEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return;
    const port = event.ports[0];
    if (!port) return;
    ports.add(port);
    let sdk: NativeSDK | null = null;
    let lastTimestamp = 0;
    let stopped = true;
    const post = (value: unknown) => { try { port.postMessage(value); } catch { /* window closed */ } };
    const ack = (replyId: unknown, ok = true, message = '') => post({ kind: 'ack', replyId, ok, payload: null, error: ok ? undefined : { code: 0, message, retryable: false } });
    const retire = () => {
      const prior = sdk; sdk = null; stopped = true;
      if (prior) retiring = retiring.then(async () => { try { await prior.stopAsync(); } finally { await prior.destroy(); } }).catch(() => undefined);
    };
    port.on('message', (event: Electron.MessageEvent) => {
      const d = event.data;
      if (!d || typeof d.kind !== 'string') return;
      try {
        if (d.kind === 'configure') {
          retire();
          if (!process.env.PRESAGE_API_KEY) { post({ kind: 'error', code: 0, message: 'PRESAGE_API_KEY is not configured in Electron main.', retryable: false }); return; }
          const native = require('@smartspectra/node-sdk') as typeof import('@smartspectra/node-sdk');
          sdk = new native.SmartSpectraSDK({ apiKey: process.env.PRESAGE_API_KEY, requestedMetrics: [native.MetricType.PULSE_RATE], enableTelemetry: false });
          sdk.on('processingStatus', status => post({ kind: 'processingStatus', status }));
          sdk.on('validationStatus', (code, timestampUs, hint) => post({ kind: 'validationStatus', code, timestampUs, hint }));
          sdk.on('metrics', (buf, timestampUs) => post({ kind: 'metrics', buffer: Uint8Array.from(buf).buffer, timestampUs }));
          sdk.on('error', (code, _message, retryable) => post({ kind: 'error', code, message: `Presage capture error ${code}. Check key provisioning, camera permission and capture conditions.`, retryable }));
          return;
        }
        if (d.kind === 'start') {
          const target = sdk;
          void retiring.then(() => {
            if (!target || target !== sdk) throw new Error('Capture not configured');
            target.useCustomInput(); target.start(); stopped = false; lastTimestamp = 0; ack(d.replyId);
          }).catch(() => ack(d.replyId, false, 'Presage startup failed; manual mode remains available.'));
        } else if (d.kind === 'stop') {
          stopped = true;
          void (sdk?.stopAsync() ?? Promise.resolve()).then(() => ack(d.replyId)).catch(() => ack(d.replyId, false, 'Capture stopped with an SDK error'));
        } else if (d.kind === 'destroy') { retire(); port.close(); }
        else if (d.kind === 'frame' && sdk && !stopped) {
          // MediaStream SDK emits RGBA frames. Do not permit arbitrary buffers,
          // pixel formats, dimensions, timestamps, files or shell access.
          if (!(d.buffer instanceof ArrayBuffer) || !Number.isInteger(d.width) || !Number.isInteger(d.height) || d.width < 1 || d.width > 1920 || d.height < 1 || d.height > 1080 || d.stride !== d.width * 4 || d.pixelFormat !== 2 || d.buffer.byteLength !== d.stride * d.height || !Number.isSafeInteger(d.timestampUs) || d.timestampUs <= lastTimestamp) return;
          lastTimestamp = d.timestampUs;
          try { sdk.sendFrame(new Uint8Array(d.buffer), d.width, d.height, d.stride, 2, d.timestampUs); } catch { /* frame dropped during lifecycle transition */ }
        } else if (typeof d.replyId === 'number') ack(d.replyId, false, 'Unsupported sensor operation');
      } catch { ack(d.replyId, false, 'Sensor unavailable; use manual mode.'); }
    });
    port.on('close', () => { ports.delete(port); retire(); });
    port.start();
  };
  ipcMain.on('night-relay:sensor-attach', listener);
  return () => { ipcMain.removeListener('night-relay:sensor-attach', listener); for (const port of ports) port.close(); };
}
