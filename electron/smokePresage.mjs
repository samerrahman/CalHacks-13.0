// Explicit real-camera QA only after the operator consents and is at the laptop.
// Records coarse status/calibration duration, never frames, pulse values or keys.
import { _electron } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
if (!process.argv.includes('--camera')) { console.error('Requires --camera and operator consent in the current session'); process.exit(2); }
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.HUSH_DEV_URL; delete env.HUSH_OFFLINE;
const result = { application: 'HUSH', checkedAt: new Date().toISOString(), cameraRequested: true, rawPulseRecorded: false, traceSharingEnabled: false, status: 'blocked', checks: [] };
mkdirSync('docs/qa', { recursive: true }); let app;
try {
 app = await _electron.launch({ args: ['dist-electron/main.mjs'], env, timeout: 30000 });
 const page = await app.firstWindow(); page.setDefaultTimeout(10000);
 await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus(); });
 await page.getByRole('button', { name: /Skip guidance & start/ }).waitFor({ state: 'visible', timeout: 30000 });
 const status = await page.evaluate(() => window.hush.status());
 if (!status.presage) throw new Error('Native runtime/key unavailable; capture not started');
 await page.getByRole('button', { name: /Operator settings/ }).click();
 await page.getByLabel('Pulse input').selectOption('presage');
 const deadline = Date.now() + 85000; let ready = false; let maxAcceptedSeconds = 0;
 while (Date.now() < deadline) {
  const text = await page.locator('.sensor-setup').innerText();
  const seconds = /(\d+) \/ 30 usable baseline seconds/.exec(text);
  if (seconds) maxAcceptedSeconds = Math.max(maxAcceptedSeconds, Number(seconds[1]));
  if (/LIVE · accepted sustained pulse trend/.test(text)) { ready = true; maxAcceptedSeconds = 30; break; }
  if (/Sensor error|denied|not allowed|not found|startup failed|not configured/i.test(text)) { const code = /Sensor error (-?\d+)/.exec(text);
   result.failureCategory = code ? 'SDK_ERROR' : /denied|not allowed/i.test(text) ? 'CAMERA_PERMISSION_DENIED' : /not found/i.test(text) ? 'CAMERA_NOT_FOUND' : /not configured/i.test(text) ? 'NATIVE_NOT_CONFIGURED' : 'NATIVE_STARTUP_FAILED';
   if (code) result.sdkErrorCode = Number(code[1]);
   result.reason = 'Capture unavailable: ' + result.failureCategory; break; }
  await page.waitForTimeout(500);
 }
 result.acceptedBaselineSeconds = maxAcceptedSeconds;
 if (ready) {
  await page.getByRole('button', { name: /Skip guidance & start/ }).click();
  await page.getByRole('button', { name: /Skip opening/ }).click();
  await page.getByRole('button', { name: /Judge view/ }).click();
  const panel = page.locator('.judge-panel'); await panel.waitFor();
  result.sensorLabel = await page.locator('.sensor-label').innerText();
  const qualityText = await panel.locator('p').filter({ hasText: /Quality:/ }).innerText();
  result.qualityAcceptedInGame = /Quality: accepted/.test(qualityText);
  result.baselineReadyInGame = /baseline: 30\/30 usable seconds/.test(qualityText);
  await panel.screenshot({ path: 'docs/qa/lock-in-presage-live.png' });
  await page.getByRole('button', { name: /Stop capture → neutral play/ }).click();
  await page.getByText('PULSE INPUT OFF · NEUTRAL', { exact: true }).first().waitFor();
  result.captureStoppedThroughUI = true;
  await page.getByRole('button', { name: 'Pause game', exact: true }).click();
  result.status = result.qualityAcceptedInGame && result.baselineReadyInGame ? 'passed' : 'blocked';
  result.reason = result.status === 'passed' ? 'Actual Presage capture, accepted baseline and coarse in-game sensor status passed; no induced physiology or raw report recording' : 'Baseline acquired but no accepted in-game sample at observation';
 } else {
  await page.getByRole('button', { name: /Stop capture → neutral play/ }).click();
  result.captureStoppedThroughUI = true;
  result.reason ??= 'No complete accepted baseline in bounded 85-second capture window';
 }
} catch { result.reason = 'Camera driver did not complete; capture was stopped when the test window closed. Check local camera permission and setup guidance.'; }
finally { if (app) await app.close(); writeFileSync('docs/qa/lock-in-presage-live.json', JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result, null, 2)); if (result.status !== 'passed') process.exitCode = 1; }
