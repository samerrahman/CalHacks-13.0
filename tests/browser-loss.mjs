import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { begin, openTerminal, resources, collectBrowserEvidence, TEST_URL } from './lock-in-browser-helpers.mjs';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const evidence = { passed: false, url: TEST_URL, mode: 'offline, manual pulse, trace sharing off', checks: [], errors: [], failedResources: [], externalRequests: [] }; let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); collectBrowserEvidence(page, evidence);
  page.on('request', request => { const url = new URL(request.url()); if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname)) evidence.externalRequests.push(`${url.origin}${url.pathname}`); });
  await begin(page); await openTerminal(page);
  await expect(page.locator('.task-progress')).toContainText('0 / 8');
  evidence.initialResources = await resources(page);
  await expect(page.getByRole('complementary', { name: 'Survival resources' })).toContainText('SEDATIVE HOLD');
  // Deliberately make visible mistakes, then leave the noisy machines running.
  // This exercises the actual danger mechanism without touching simulation data.
  for (let attempt = 0; attempt < 6; attempt++) {
    const quietMachines = page.getByRole('button', { name: /^Machine [1-4] QUIET$/ });
    const count = await quietMachines.count();
    if (!count) throw Error('No visibly quiet machine available for the deliberate wrong input');
    await quietMachines.first().click(); await page.waitForTimeout(300);
  }
  evidence.afterMistakes = await resources(page);
  if (evidence.afterMistakes.danger <= evidence.initialResources.danger) throw Error('Visible mistakes did not increase danger');
  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  await expect(page.locator('.sound-caption')).toContainText('PROXIMITY ALARM', { timeout: 180000 });
  await expect(page.locator('.breach-banner')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/harder-alarm-active.png' });
  await page.keyboard.press('j');
  evidence.alarmAudio = JSON.parse(await page.getByTestId('audio-diagnostics').innerText());
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Game paused' })).toBeVisible();
  const pausedTrace = await page.locator('.trace-list').innerText();
  const pausedCaption = await page.locator('.sound-caption').innerText();
  const pausedDeadline = await page.getByTestId('run-deadline').innerText();
  await page.waitForTimeout(8000);
  await expect.poll(() => page.locator('.trace-list').innerText()).toBe(pausedTrace);
  await expect.poll(() => page.locator('.sound-caption').innerText()).toBe(pausedCaption);
  await expect(page.getByTestId('run-deadline')).toHaveText(pausedDeadline);
  await expect(page.locator('.jump-scare.breach')).toHaveCount(0);
  evidence.checks.push('Alarm has sound-equivalent captions and no visible breach countdown; pause freezes public event times and threat beyond the normal loss interval');
  await page.screenshot({ path: 'artifacts/harder-loss-paused.png' });
  await page.getByRole('button', { name: 'Resume protocol →' }).click();
  // The judge trace is a player-visible diagnostic, not hidden simulation state.
  await expect(page.locator('.trace-list')).toContainText('ATTACK_COMMITTED', { timeout: 180000 });
  evidence.committedEvent = await page.locator('.trace-list > div').filter({ hasText: 'ATTACK_COMMITTED' }).innerText();
  await page.keyboard.press('q');
  await expect(page.locator('.sound-caption')).toContainText('Isolation relay disengaged.');
  await expect(page.locator('.jump-scare.breach')).toBeVisible({ timeout: 4000 });
  await page.screenshot({ path: 'artifacts/harder-breach-scare-active.png' });
  await expect(page.getByRole('heading', { name: 'The shelter fell silent.', exact: true })).toBeVisible({ timeout: 4000 });
  const result = page.getByRole('dialog', { name: 'Run results' });
  await expect(result).toContainText('Isolation must be used before its final strike.');
  await expect(result).toContainText('Physiological statistics unrecorded.');
  await page.screenshot({ path: 'artifacts/harder-loss-result.png' });
  evidence.result = await result.innerText();
  evidence.checks.push('Q after the publicly recorded commitment cannot rescue the run; an actual breach scare precedes the explained loss');
  await page.getByRole('button', { name: 'Replay this seed', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Research terminal' })).toHaveCount(0);
  await openTerminal(page);
  await expect(page.locator('.task-progress')).toContainText('0 / 8');
  await expect(page.locator('.protocol-progress b')).toHaveText('0 / 4');
  await expect(page.locator('.isolation-reserve b')).toHaveText('4 / 4');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Game paused' })).toBeVisible();
  evidence.checks.push('Replay resets research and returns to equipment interaction; keyboard pause remains available');
  if (evidence.errors.length || evidence.failedResources.length || evidence.externalRequests.length) throw Error('Unexpected browser error, missing asset, or external request');
  evidence.passed = true;
} catch (error) {
  evidence.failure = String(error); process.exitCode = 1;
  if (page) { await page.screenshot({ path: 'artifacts/harder-loss-failure.png' }); evidence.visibleTextAtFailure = await page.locator('body').innerText(); }
} finally { await writeFile('artifacts/harder-loss-evidence.json', JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence)); await browser.close(); }
