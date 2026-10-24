import { _electron } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ args: ['dist-electron/main.mjs'], env, timeout: 30000 });
const errors = [];
const resources = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (/\.(glb|wav)(?:\?|$)/.test(response.url())) resources.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  await page.getByRole('button', { name: /Take the night shift/ }).waitFor({ state: 'visible', timeout: 30000 });
  const status = await page.evaluate(() => window.nightRelay.status());
  await page.getByRole('button', { name: /Operator settings/ }).click();
  await page.getByLabel('Share sanitized events with judge view').check();
  await page.getByRole('button', { name: /Take the night shift/ }).click();
  await page.keyboard.press('j');
  const judgePromise = app.waitForEvent('window', { timeout: 10000 });
  await page.getByRole('button', { name: /Open second screen/ }).click();
  const judge = await judgePromise;
  await judge.getByRole('heading', { name: 'Behind the signal.' }).waitFor();
  await judge.getByText('LOCAL BROADCAST · OFFLINE').waitFor({ timeout: 10000 });
  const security = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({ nodeIntegration: w.webContents.getLastWebPreferences().nodeIntegration, contextIsolation: w.webContents.getLastWebPreferences().contextIsolation, sandbox: w.webContents.getLastWebPreferences().sandbox })));
  const judgeHasPrivilegedBridge = await judge.evaluate(() => !!window.nightRelay);
  mkdirSync('docs/qa', { recursive: true });
  await page.screenshot({ path: 'docs/qa/electron-game.png' });
  const result = { status, security, judgeHasPrivilegedBridge, judgeTraceReceived: true, resources, errors };
  writeFileSync('docs/qa/electron-smoke.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (errors.length || judgeHasPrivilegedBridge) process.exitCode = 1;
} finally { await app.close(); }
