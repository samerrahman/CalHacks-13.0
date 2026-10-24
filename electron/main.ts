import { app, BrowserWindow, ipcMain, session, protocol, net } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { geminiProposal, elevenSpeech, generateMonster, validSpeechRequest } from '../src/integrations/providers';
import { publicDirectorRequest, publicMonsterRequest, authoredMonsterFallback, isAuthoredCaption, MONSTER_MIN_INTERVAL_MS } from '../src/integrations/contracts';
import { bindPresage } from './presageAdapter';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Node's native env reader keeps secrets in the trusted main process.
for (const name of ['.env', '.env.local']) { const p = path.join(root, name); if (existsSync(p)) process.loadEnvFile(p); }
// Explicit QA gate: a configured account must not turn an offline smoke into
// a live network/camera test. This mutates only the child process environment.
const offline = process.env.LOCK_IN_OFFLINE === '1';
if (offline) for (const name of ['PRESAGE_API_KEY', 'GEMINI_API_KEY', 'ELEVENLABS_API_KEY', 'VITE_CONVEX_URL']) delete process.env[name];
app.setName('Lock In');
protocol.registerSchemesAsPrivileged([{ scheme: 'lockin', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
let mainWindow: BrowserWindow | null = null;
let nativeAvailable = false;
let nativeReason = 'Presage key not configured';
if (process.env.PRESAGE_API_KEY) {
  try { require('@smartspectra/node-sdk'); nativeAvailable = true; nativeReason = ''; }
  catch { nativeReason = 'Presage native runtime did not load on this laptop'; }
}
function trusted(event: Electron.IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('Untrusted caller');
}
let lastDirectorAt = -Infinity;
let lastSpeechAt = -Infinity;
let lastMonsterAt = -Infinity;
const directorIds = new Set<string>();
const speechIds = new Set<string>();
const monsterIds = new Set<string>();
function restrictNavigation(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', e => e.preventDefault());
}
function contentPolicy(): string {
  const dev = !!process.env.LOCK_IN_DEV_URL;
  return `default-src 'self'; script-src 'self'${dev ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self' ws://127.0.0.1:5173 ws://localhost:5173 https://*.convex.cloud wss://*.convex.cloud; object-src 'none'; base-uri 'self'; frame-src 'none'`;
}
ipcMain.handle('lock-in:status', event => {
  trusted(event);
  return { desktop: true, offline, presage: nativeAvailable, gemini: !!(process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL), elevenlabs: !!(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID && process.env.ELEVENLABS_MODEL_ID), convex: !!process.env.VITE_CONVEX_URL, reasons: nativeReason ? [nativeReason] : [] };
});
ipcMain.handle('lock-in:director', async (event, raw) => {
  trusted(event);
  const request = publicDirectorRequest(raw);
  if (directorIds.has(request.requestId) || performance.now() - lastDirectorAt < 12_000) return { proposal: null, source: 'fallback', latencyMs: 0, reason: 'Duplicate or rate-limited director request' };
  directorIds.add(request.requestId); lastDirectorAt = performance.now();
  if (directorIds.size > 500) directorIds.delete(directorIds.values().next().value!);
  return geminiProposal(request, process.env);
});
ipcMain.handle('lock-in:speech', async (event, request) => {
  trusted(event);
  if (!validSpeechRequest(request) || !isAuthoredCaption(request.caption)) throw new Error('Speech must match a valid authored caption');
  if (speechIds.has(request?.requestId) || performance.now() - lastSpeechAt < 1500) return { audioBase64: null, mimeType: 'audio/mpeg', source: 'fallback', latencyMs: 0, reason: 'Duplicate or rate-limited speech' };
  speechIds.add(request?.requestId); lastSpeechAt = performance.now();
  if (speechIds.size > 500) speechIds.delete(speechIds.values().next().value!);
  return elevenSpeech(request, process.env);
});
ipcMain.handle('lock-in:monster', async (event, raw) => {
  trusted(event);
  const request = publicMonsterRequest(raw);
  if (offline) return authoredMonsterFallback(request, 'Offline mode · authored monster dialogue');
  if (monsterIds.has(request.requestId) || performance.now() - lastMonsterAt < MONSTER_MIN_INTERVAL_MS) return authoredMonsterFallback(request, 'Duplicate or rate-limited monster dialogue');
  monsterIds.add(request.requestId); lastMonsterAt = performance.now();
  if (monsterIds.size > 500) monsterIds.delete(monsterIds.values().next().value!);
  return generateMonster(request, process.env);
});

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({ width: 1440, height: 960, minWidth: 900, minHeight: 640, title: 'LOCK IN', backgroundColor: '#071114', webPreferences: { preload: path.join(root, 'dist-electron/preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  mainWindow = win;
  const unbind = bindPresage(win);
  win.on('closed', () => { unbind(); mainWindow = null; });
  restrictNavigation(win);
  win.webContents.setWindowOpenHandler(({ url }) => {
    const target = new URL(url);
    const current = new URL(win.webContents.getURL());
    if (target.protocol === current.protocol && target.host === current.host && target.pathname === current.pathname && target.hash.startsWith('#judge=') && BrowserWindow.getAllWindows().length < 3) {
      const judge = new BrowserWindow({ width: 1100, height: 800, title: 'LOCK IN · Judge trace', backgroundColor: '#071114', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
      restrictNavigation(judge);
      void judge.loadURL(target.href);
    }
    return { action: 'deny' };
  });
  const developmentUrl = process.env.LOCK_IN_DEV_URL;
  if (developmentUrl) {
    const parsed = new URL(developmentUrl);
    if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.protocol !== 'http:') throw new Error('Only local development servers are permitted');
    await win.loadURL(developmentUrl);
  } else await win.loadURL('lockin://app/index.html');
}
void app.whenReady().then(async () => {
  protocol.handle('lockin', async request => {
    const url = new URL(request.url);
    if (url.host !== 'app' || request.method !== 'GET') return new Response('Not found', { status: 404 });
    const directory = path.join(root, 'dist');
    let file: string;
    try { file = path.resolve(directory, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`); }
    catch { return new Response('Not found', { status: 404 }); }
    if (!file.startsWith(`${directory}${path.sep}`)) return new Response('Not found', { status: 404 });
    try {
      const response = await net.fetch(pathToFileURL(file).href);
      const headers = new Headers(response.headers); headers.set('Content-Security-Policy', contentPolicy());
      return new Response(response.body, { status: response.status, headers });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [contentPolicy()] } });
  });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : [];
    callback(contents === mainWindow?.webContents && permission === 'media' && mediaTypes?.length === 1 && mediaTypes[0] === 'video');
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => contents === mainWindow?.webContents && permission === 'media' && details.mediaType === 'video');
  await createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) void createWindow(); });
});
app.on('window-all-closed', () => app.quit());
