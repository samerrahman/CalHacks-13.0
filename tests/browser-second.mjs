import { chromium, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { begin, restore, solve, evidenceFor, collectBrowserEvidence, TEST_URL } from './lock-in-browser-helpers.mjs';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const evidence = { passed: false, url: TEST_URL, seed: 18, checks: [], errors: [], failedResources: [] }; let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); collectBrowserEvidence(page, evidence);
  await begin(page, { seed: 18, simulated: true, record: true });
  await expect(page.locator('.sensor-label')).toContainText('SIMULATED');
  await page.keyboard.press('q');
  await expect(page.locator('[data-tutorial="emergency-restore"]')).toHaveClass(/ready/, { timeout: 20000 });
  await page.keyboard.press('j');
  await expect(page.locator('.judge-panel')).toContainText('30/30 usable seconds', { timeout: 50000 });
  await page.getByLabel('Simulate sustained +12 BPM (development)').check();
  await page.getByRole('button', { name: 'Close ×', exact: true }).click();
  await expect(page.locator('.sensor-label')).toContainText('SIMULATED · ELEVATED', { timeout: 35000 });
  await page.screenshot({ path: 'artifacts/harder-simulated-calibrated.png' });
  evidence.checks.push('Opt-in simulated data calibrates and sustained ELEVATED does not kill an isolated player');
  await restore(page);
  await solve(page, { delayStageThree: true });
  await expect(page.getByRole('dialog', { name: 'Run results' })).toContainText('4/4');
  await expect(page.locator('.pulse-report')).toContainText('SIMULATED DATA');
  await page.screenshot({ path: 'artifacts/harder-seed18-report.png' });
  evidence.observations = evidenceFor(page); evidence.report = await page.locator('.pulse-report').innerText();
  if (!evidence.observations.blackouts) throw Error('The delayed overload run did not exercise a visible blackout');
  evidence.checks.push('Seed18 won harder puzzles with early isolation, visible blackout recovery and an opt-in simulated report');
  await page.getByRole('button', { name: 'Delete report & shared session', exact: true }).click();
  await expect(page.locator('.pulse-report')).toContainText('Physiological statistics unrecorded.');
  evidence.checks.push('Delete removes the local timeline and derived pulse statistics');
  if (evidence.errors.length || evidence.failedResources.length) throw Error('Browser errors or missing resources');
  evidence.passed = true;
} catch (error) {
  evidence.failure = String(error); process.exitCode = 1;
  if (page) { await page.screenshot({ path: 'artifacts/harder-seed18-failure.png' }); evidence.visibleTextAtFailure = await page.locator('body').innerText(); }
} finally { await writeFile('artifacts/harder-seed18-evidence.json', JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence)); await browser.close(); }
