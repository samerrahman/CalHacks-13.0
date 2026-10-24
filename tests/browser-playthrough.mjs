import { chromium, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { begin, openTerminal, watchSequence, restore, defend, resources, solve, evidenceFor, collectBrowserEvidence, TEST_URL } from './lock-in-browser-helpers.mjs';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const evidence = { passed: false, url: TEST_URL, seed: 17, checks: [], errors: [], failedResources: [] }; let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); collectBrowserEvidence(page, evidence);
  await begin(page, { tutorial: true });
  await expect(page.locator('.tutorial-card')).toContainText('press E');
  await page.screenshot({ path: 'artifacts/harder-tutorial-use.png' });
  await openTerminal(page);
  await page.getByRole('button', { name: /^Machine [1-4] FAULT$/ }).first().click();
  await expect(page.locator('.tutorial-card')).toContainText('Press Q');
  await page.keyboard.press('q');
  await expect(page.locator('.tutorial-card')).toContainText('Listen for receding footsteps');
  await expect(page.locator('.tutorial-card')).toContainText('Hold F', { timeout: 20000 });
  await page.screenshot({ path: 'artifacts/harder-tutorial-quiet.png' });
  await restore(page); await openTerminal(page);
  await expect(page.locator('.tutorial-card')).toContainText('Press R');
  await watchSequence(page, { tutorial: true });
  await expect(page.locator('.tutorial-card')).toContainText('Press T');
  await page.getByRole('button', { name: 'T Transmit', exact: true }).click();
  await expect(page.locator('.tutorial-card')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Research terminal' })).toHaveCount(0);
  evidence.checks.push('Physical-equipment E interaction and all seven nonlethal tutorial steps completed through visible controls');
  const initial = await resources(page);
  if (initial.cells !== 4 || !/^4:5[0-9]$|^5:00$/.test(initial.deadline)) throw Error('New run did not reset four cells and five-minute deadline');
  await defend(page);
  evidence.checks.push('One visible isolation cell is consumed; equipment returns automatically after ten seconds and cooldown prevents immediate reuse');
  await openTerminal(page); await page.screenshot({ path: 'artifacts/harder-terminal.png' });
  await solve(page);
  const result = page.getByRole('dialog', { name: 'Run results' });
  await expect(result).toContainText('4/4');
  await expect(result).toContainText('Physiological statistics unrecorded.');
  await page.screenshot({ path: 'artifacts/harder-seed17-win.png' });
  evidence.checks.push('Seed17 won eight faults + wiring, five pulses, twelve faults + wiring, six pulses, and containment through observed controls');
  evidence.observations = evidenceFor(page); evidence.result = await result.innerText();
  if (!evidence.observations.sequenceLengths.includes(5) || !evidence.observations.sequenceLengths.includes(6)) throw Error('Longer real sequence lengths were not observed');
  if (!evidence.observations.defenses) throw Error('No early defense exercised');
  if (evidence.observations.wireBoards !== 2 || evidence.observations.wireDrags < 1 || evidence.observations.wireClicks < 1) throw Error('Both wire boards and real drag/click controls were not exercised');
  if (evidence.errors.length || evidence.failedResources.length) throw Error('Browser errors or missing resources');
  evidence.passed = true;
} catch (error) {
  evidence.failure = String(error); process.exitCode = 1;
  if (page) { await page.screenshot({ path: 'artifacts/harder-seed17-failure.png' }); evidence.visibleTextAtFailure = await page.locator('body').innerText(); }
} finally { await writeFile('artifacts/harder-seed17-evidence.json', JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence)); await browser.close(); }
