import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lockIn', {
  status: () => ipcRenderer.invoke('lock-in:status'),
  director: (request: unknown) => ipcRenderer.invoke('lock-in:director', request),
  speech: (request: unknown) => ipcRenderer.invoke('lock-in:speech', request),
  monster: (request: unknown) => ipcRenderer.invoke('lock-in:monster', request),
});

// Narrow compatibility surface required by the installed renderer SDK. The
// main process independently validates sender, operations and frame bounds.
let port: MessagePort | null = null;
let onMessage: ((value: unknown) => void) | null = null;
contextBridge.exposeInMainWorld('__smartspectraBridge', {
  diagnostics: false,
  attach() {
    if (port) return;
    const channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = e => onMessage?.(e.data);
    ipcRenderer.postMessage('lock-in:sensor-attach', null, [channel.port2]);
    port.start();
  },
  postMessage(message: { kind?: string }) {
    if (!port || !['configure', 'start', 'stop', 'destroy', 'frame'].includes(message?.kind ?? '')) throw new Error('Unsupported sensor operation');
    port.postMessage(message);
  },
  onMessage(callback: (value: unknown) => void) { onMessage = typeof callback === 'function' ? callback : null; },
  close() { port?.close(); port = null; onMessage = null; },
});
