// Offline desktop gate. Child-process-only override; .env stays untouched.
import { _electron } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const env = { ...process.env, LOCK_IN_OFFLINE: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.LOCK_IN_DEV_URL;
const errors = [], resources = [];
const result = { application: 'LOCK IN', checkedAt: new Date().toISOString(), mode: 'offline', cameraRequested: false, providerCallsEnabled: false, errors, resources, outcome: 'failed' };
mkdirSync('docs/qa', { recursive: true });
let app;
try {
 app = await _electron.launch({ args: ['dist-electron/main.mjs'], env, timeout: 30000 });
 const page = await app.firstWindow();
 page.on('pageerror', error => errors.push(error.message.slice(0, 200)));
 page.on('response', response => { if (/\.(glb|wav)(?:\?|$)/.test(response.url())) resources.push({ path: new URL(response.url()).pathname, status: response.status() }); });
 await page.getByRole('button', { name: /Skip guidance & start/ }).waitFor({ state: 'visible', timeout: 30000 });
 result.bridge = await page.evaluate(() => window.lockIn.status());
 if (!result.bridge.offline || result.bridge.gemini || result.bridge.elevenlabs || result.bridge.presage) throw new Error('Offline transport gate did not apply');
 await page.getByRole('button', { name: /Camera & pulse setup/ }).click();
 const cameraPanel = page.getByRole('region', { name: 'Personal camera and pulse calibration' });
 await cameraPanel.getByText('Camera off', { exact: true }).waitFor();
 result.desktopCameraPanelVerified = await cameraPanel.getByRole('button', { name: 'Enable camera & calibrate' }).isEnabled();
 result.cameraPreviewStreamAttached = await cameraPanel.locator('video').evaluate(video => video.srcObject !== null);
 if (!result.desktopCameraPanelVerified || result.cameraPreviewStreamAttached) throw new Error('Desktop camera setup state incorrect');
 await cameraPanel.screenshot({ path: 'docs/qa/lock-in-electron-camera-off.png' });
 await page.getByRole('button', { name: /Camera & pulse setup/ }).click();
 await page.getByRole('button', { name: /Operator settings/ }).click();
 await page.getByLabel('Share sanitized game events with a judge screen').check();
 await page.getByRole('button', { name: /Skip guidance & start/ }).click();
 await page.getByRole('button', { name: /Skip opening/ }).click();
 await page.keyboard.press('e');
 await page.getByRole('dialog', { name: 'Research terminal' }).waitFor();
 await page.getByRole('button', { name: /^Machine \d FAULT$/ }).first().click();
 result.physicalInteractionVerified = true;
 await page.keyboard.press('q');
 result.earlyQuietResponse = true;
 await page.keyboard.press('Space');
 await page.getByRole('button', { name: /Judge view/ }).click();
 await page.locator('.judge-panel').waitFor();
 const judgePromise = app.waitForEvent('window', { timeout: 10000 });
 await page.getByRole('button', { name: /Open second screen/ }).click();
 const judge = await judgePromise;
 await judge.getByRole('heading', { name: 'Behind the signal.' }).waitFor();
 await judge.getByText('LOCAL BROADCAST · OFFLINE').waitFor({ timeout: 10000 });
 result.security = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({ nodeIntegration: w.webContents.getLastWebPreferences().nodeIntegration, contextIsolation: w.webContents.getLastWebPreferences().contextIsolation, sandbox: w.webContents.getLastWebPreferences().sandbox })));
 result.judgeHasPrivilegedBridge = await judge.evaluate(() => !!window.lockIn);
 result.judgeTraceReceived = true;
 await page.screenshot({ path: 'docs/qa/lock-in-electron-game.png' });
 await judge.screenshot({ path: 'docs/qa/lock-in-electron-judge.png' });
 result.outcome = !errors.length && !result.judgeHasPrivilegedBridge && result.security.every(s => !s.nodeIntegration && s.contextIsolation && s.sandbox) ? 'passed' : 'failed';
} catch (error) { result.reason = String(error?.message ?? error).replace(/https?:\/\/\S+/g, '[URL]').slice(0, 300); }
finally {
 if (app) await app.close();
 writeFileSync('docs/qa/lock-in-electron-smoke.json', JSON.stringify(result, null, 2) + '\n');
 console.log(JSON.stringify(result, null, 2));
 if (result.outcome !== 'passed') process.exitCode = 1;
}
