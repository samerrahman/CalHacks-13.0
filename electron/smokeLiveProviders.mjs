// Opt-in real-provider game smoke. It uses visible controls and reads only the
// sanitized judge panel; it never injects game state or requests camera capture.
import { _electron } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

if (!process.argv.includes('--live')) {
  console.error('Explicit live check required: node electron/smokeLiveProviders.mjs --live');
  process.exit(2);
}
for (const file of ['.env', '.env.local']) if (existsSync(file)) process.loadEnvFile(file);
const secrets = Object.entries(process.env).filter(([name, value]) => /KEY|TOKEN|SECRET|PASSWORD|VOICE_ID/.test(name) && value && value.length > 3).map(([, value]) => value);
function safeError(error) {
  let message = String(error?.message ?? error);
  for (const secret of secrets) message = message.split(secret).join('[REDACTED]');
  return message.replace(/https?:\/\/\S+/g, '[URL]').slice(0, 350);
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NIGHT_RELAY_DEV_URL;
const errors = [];
const result = { checkedAt: new Date().toISOString(), method: 'Actual Electron game, visible manual controls, sanitized judge DOM', cameraRequested: false, traceSharingEnabled: false, status: 'failed', errors };
mkdirSync('docs/qa', { recursive: true });
let app;
try {
  app = await _electron.launch({ args: ['dist-electron/main.mjs'], env, timeout: 30000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(safeError(error)));
  await page.getByRole('button', { name: /Take the night shift/ }).waitFor({ state: 'visible', timeout: 30000 });
  result.configured = await page.evaluate(() => window.nightRelay.status());
  if (!result.configured.gemini) {
    result.status = 'blocked'; result.reason = 'Gemini configuration unavailable; no shift started';
  } else {
    await page.getByRole('button', { name: /Operator settings/ }).click();
    await page.getByLabel('Sensor source').selectOption('manual');
    await page.getByLabel('Share sanitized events with judge view').uncheck();
    await page.getByRole('button', { name: /Take the night shift/ }).click();
    // Authored, observable choices before the model takes its state snapshot.
    await page.getByRole('button', { name: 'Open left shutter', exact: true }).click();
    await page.getByRole('button', { name: 'Close left shutter', exact: true }).click();
    await page.keyboard.press('j');
    const panel = page.locator('.trace-panel');
    await panel.waitFor();
    let requestObservedAt = null;
    let outcomeObservedAt = null;
    const deadline = Date.now() + 32000;
    let snapshot;
    while (Date.now() < deadline) {
      snapshot = await panel.evaluate(element => {
        const providers = Object.fromEntries([...element.querySelectorAll('.provider-table > div')].map(row => [row.querySelector('span')?.textContent, row.querySelector('b')?.textContent]));
        const events = [...element.querySelectorAll('.trace-list > div')].map(row => ({ time: row.querySelector('span')?.textContent, identity: row.querySelector('b')?.textContent, detail: row.lastElementChild?.textContent })).filter(event => /\/ (DIRECTOR_REQUEST|DIRECTOR_APPLIED|DIRECTOR_REJECTED|DOOR)$/.test(event.identity ?? ''));
        const tactic = [...element.querySelectorAll('p')].find(p => p.textContent?.startsWith('Tactic:'))?.textContent;
        return { providers, events, tactic };
      });
      if (requestObservedAt === null && snapshot.events.some(e => e.identity.endsWith('/ DIRECTOR_REQUEST'))) requestObservedAt = Date.now();
      if (snapshot.events.some(e => e.identity.endsWith('/ DIRECTOR_APPLIED'))) { outcomeObservedAt = Date.now(); break; }
      await page.waitForTimeout(100);
    }
    // Capture while visible, then freeze through a player control before a
    // second scheduled request can run (the next request is at least 12s later).
    await panel.screenshot({ path: 'docs/qa/electron-live-providers.png' });
    await page.keyboard.press('Escape');
    result.judge = snapshot;
    result.observedRequestToOutcomeMs = requestObservedAt !== null && outcomeObservedAt !== null ? outcomeObservedAt - requestObservedAt : null;
    const label = snapshot?.providers?.GEMINI ?? '';
    result.providerLatencyMs = /LIVE · (\d+)ms/.test(label) ? Number(/LIVE · (\d+)ms/.exec(label)[1]) : null;
    const accepted = snapshot?.events.some(e => e.identity.endsWith('/ DIRECTOR_APPLIED') && /^GEMINI selected /.test(e.detail ?? ''));
    result.status = accepted && !errors.length ? 'passed' : 'failed';
    result.reason = accepted ? 'Real proposal accepted by the actual game reducer and displayed as GEMINI in the judge trace' : 'No accepted live proposal observed in the bounded first-request window';
  }
} catch (error) { result.reason = safeError(error); }
finally {
  if (app) await app.close().catch(error => errors.push(safeError(error)));
  writeFileSync('docs/qa/electron-live-providers.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'passed') process.exitCode = 1;
}
