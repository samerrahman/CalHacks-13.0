import { chromium, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { begin, guardDanger, solve, evidenceFor, collectBrowserEvidence, TEST_URL } from './lock-in-browser-helpers.mjs';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const evidence = { passed: false, url: TEST_URL, seed: 18, checks: [], errors: [], failedResources: [] }; let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); collectBrowserEvidence(page, evidence);
  await begin(page, { seed: 18, simulated: true, record: true, calibrate: true });
  await expect(page.locator('.sensor-label')).toContainText('SIMULATED');
  await page.keyboard.press('j');
  await expect(page.locator('.judge-panel')).toContainText('30/30 usable seconds');
  await page.getByLabel('Simulate sustained +12 BPM (development)').check();
  await page.getByRole('button', { name: 'Close ×', exact: true }).click();
  const trendDeadline = Date.now() + 35000;
  while (!/SIMULATED · ELEVATED/.test(await page.locator('.sensor-label').innerText()) && Date.now() < trendDeadline) { await guardDanger(page); await page.waitForTimeout(100); }
  await expect(page.locator('.sensor-label')).toContainText('SIMULATED · ELEVATED');
  await page.screenshot({ path: 'artifacts/harder-simulated-calibrated.png' });
  evidence.checks.push('Opt-in simulated baseline survives setup-to-game handoff; accepted sustained ELEVATED appears without raw data injection');
  const encounterDeadline = Date.now() + 150000;
  while (!evidenceFor(page).naturalAlarmDefenses && Date.now() < encounterDeadline) {
    await guardDanger(page); await page.waitForTimeout(100);
  }
  if (!evidenceFor(page).naturalAlarmDefenses) throw Error('No natural proximity-alarm defense completed during the bounded encounter observation');
  await page.screenshot({ path: 'artifacts/survival-natural-defense.png' });
  evidence.checks.push('A naturally approaching creature triggers the visible proximity alarm; timely Q survives the encounter and automatically restores equipment');
  await solve(page, { delayStageThree: true });
  await expect(page.getByRole('dialog', { name: 'Run results' })).toContainText('4/4');
  await expect(page.locator('.pulse-report')).toContainText('SIMULATED DATA');
  await page.screenshot({ path: 'artifacts/harder-seed18-report.png' });
  evidence.observations = evidenceFor(page); evidence.report = await page.locator('.pulse-report').innerText();
  if (!evidence.observations.blackouts) throw Error('The delayed overload run did not exercise a visible blackout');
  if (evidence.observations.wireBoards !== 2) throw Error('Both visible wiring boards were not completed');
  evidence.checks.push('Seed18 won both fault/wire and memory stages with limited isolation, F-only blackout recovery and an opt-in simulated report');
  await page.getByRole('button', { name: 'Delete report & shared session', exact: true }).click();
  await expect(page.locator('.pulse-report')).toContainText('Physiological statistics unrecorded.');
  evidence.checks.push('Delete removes the local timeline and derived pulse statistics');
  if (evidence.errors.length || evidence.failedResources.length) throw Error('Browser errors or missing resources');
  evidence.passed = true;
} catch (error) {
  evidence.failure = String(error); process.exitCode = 1;
  if (page) { await page.screenshot({ path: 'artifacts/harder-seed18-failure.png' }); evidence.visibleTextAtFailure = await page.locator('body').innerText(); }
} finally { await writeFile('artifacts/harder-seed18-evidence.json', JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence)); await browser.close(); }
