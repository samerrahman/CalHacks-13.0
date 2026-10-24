// Run only after Gemini and ElevenLabs stage checks: the actual game can call
// both providers. Visible controls only; no hidden state injection or camera.
import { _electron } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
if (!process.argv.includes('--live')) { console.error('Requires --live after offline/provider gates'); process.exit(2); }
for (const file of ['.env', '.env.local']) if (existsSync(file)) process.loadEnvFile(file);
const secrets = Object.entries(process.env).filter(([name, value]) => /KEY|TOKEN|SECRET|PASSWORD|VOICE_ID/.test(name) && value && value.length > 3).map(([, value]) => value);
function safeError(error) { let message = String(error?.message ?? error); for (const secret of secrets) message = message.split(secret).join('[REDACTED]'); return message.replace(/https?:\/\/\S+/g, '[URL]').slice(0, 350); }
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.LOCK_IN_DEV_URL; delete env.LOCK_IN_OFFLINE;
const errors = [];
const suffix = process.argv.includes('--alternate') ? '-alternate' : '';
const result = { configuredModel: process.env.GEMINI_MODEL, application: 'LOCK IN', checkedAt: new Date().toISOString(), method: 'Actual Electron game, visible manual controls, sanitized judge DOM', cameraRequested: false, traceSharingEnabled: false, status: 'failed', errors };
mkdirSync('docs/qa', { recursive: true }); let app;
try {
 app = await _electron.launch({ args: ['dist-electron/main.mjs'], env, timeout: 30000 });
 const page = await app.firstWindow(); page.setDefaultTimeout(10000);
 await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus(); });
 page.on('pageerror', error => errors.push(safeError(error)));
 await page.getByRole('button', { name: /Skip guidance & start/ }).waitFor({ state: 'visible', timeout: 30000 });
 result.configured = await page.evaluate(() => window.lockIn.status());
 if (!result.configured.gemini) { result.status = 'blocked'; result.reason = 'Gemini configuration unavailable; no game started'; }
 else {
  await page.getByRole('button', { name: /Operator settings/ }).click();
  await page.getByLabel('Pulse input').selectOption('manual');
  await page.getByLabel('Share sanitized game events with a judge screen').uncheck();
  await page.getByRole('button', { name: /Skip guidance & start/ }).click();
  await page.getByRole('button', { name: /Skip cutscene/ }).click();
  // A visible mistake provides observable sound evidence for the first request.
  await page.getByRole('button', { name: /^Machine \d QUIET$/ }).first().click();
  await page.getByRole('button', { name: /Judge view/ }).click();
  const panel = page.locator('.judge-panel'); await panel.waitFor();
  let requestObservedAt = null, outcomeObservedAt = null, snapshot;
  const deadline = Date.now() + 90000; result.visibilityPausesResumed = 0; result.quietResponses = 0; result.safeRestores = 0;
  while (Date.now() < deadline) {
   const resume = page.getByRole('button', { name: /Resume protocol/ });
   if (await resume.isVisible()) { await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus(); }); await resume.click(); result.visibilityPausesResumed++; }
   if (await page.getByRole('dialog', { name: 'Run results' }).isVisible()) { result.gameEndedBeforeOutcome = true; break; }
   if (await page.locator('.breach-banner').isVisible()) { await page.keyboard.press('q'); result.quietResponses++; }
   if (await page.locator('.quiet-status').getByRole('heading', { name: 'A clear moment.' }).isVisible()) { await page.keyboard.down('f'); await page.waitForTimeout(1250); await page.keyboard.up('f'); result.safeRestores++; }
   snapshot = await panel.evaluate(element => ({
    providers: Object.fromEntries([...element.querySelectorAll('.provider-table > div')].map(row => [row.querySelector('span')?.textContent, row.querySelector('b')?.textContent])),
    events: [...element.querySelectorAll('.trace-list > div')].map(row => ({ time: row.querySelector('time')?.textContent, identity: row.querySelector('b')?.textContent, detail: row.querySelector('span')?.textContent })).filter(event => /\/ (DIRECTOR_REQUESTED|DIRECTOR_APPLIED|DIRECTOR_REJECTED|WRONG_INPUT|FAULT_CLEARED|QUIET_ENTERED|RESTORED)$/.test(event.identity ?? '')),
    tactic: [...element.querySelectorAll('p')].find(p => p.textContent?.startsWith('Tactic:'))?.textContent,
    audio: JSON.parse(element.querySelector('[data-testid=audio-diagnostics]')?.textContent ?? '{}')
   }));
   if (requestObservedAt === null && snapshot.events.some(e => e.identity.endsWith('/ DIRECTOR_REQUESTED'))) requestObservedAt = Date.now();
   if (snapshot.events.some(e => e.identity.endsWith('/ DIRECTOR_APPLIED'))) { outcomeObservedAt = Date.now(); break; }
   await page.waitForTimeout(100);
  }
  await page.screenshot({ path: `docs/qa/lock-in-electron-live-providers${suffix}.png` });
  result.judge = snapshot;
  if (!result.gameEndedBeforeOutcome) await page.keyboard.press('Escape');
  result.observedRequestToOutcomeMs = requestObservedAt !== null && outcomeObservedAt !== null ? outcomeObservedAt - requestObservedAt : null;
  const label = snapshot?.providers?.GEMINI ?? '';
  result.providerLatencyMs = /LIVE · (\d+)ms/.test(label) ? Number(/LIVE · (\d+)ms/.exec(label)[1]) : null;
  const accepted = snapshot?.events.some(e => e.identity.endsWith('/ DIRECTOR_APPLIED') && /^GEMINI /.test(e.detail ?? ''));
  result.speechGenerated = /^LIVE/.test(snapshot?.providers?.ELEVENLABS ?? '');
  result.speechPlaybackVerified = result.speechGenerated && snapshot?.audio?.decodedSpeech > 0 && snapshot?.audio?.startedSpeech > 0 && snapshot?.audio?.playbackErrors === 0 && snapshot?.audio?.contextState === 'running';
  result.status = accepted && !errors.length ? 'passed' : 'failed';
  result.reason = accepted ? 'Real LOCK IN proposal accepted by actual reducer; manual sensing, no camera or shared trace' : 'No accepted live proposal in bounded first-request window';
 }
} catch (error) { result.reason = safeError(error); }
finally { if (app) await app.close().catch(error => errors.push(safeError(error))); writeFileSync(`docs/qa/lock-in-electron-live-providers${suffix}.json`, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result, null, 2)); if (result.status !== 'passed') process.exitCode = 1; }
