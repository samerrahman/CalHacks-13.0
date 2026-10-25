import { chromium, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { begin, openTerminal, guardDanger, resources, collectBrowserEvidence, endOfIsolation, fixFaultByEar, TEST_URL } from './hush-browser-helpers.mjs';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const evidence = { passed: false, url: TEST_URL, checks: [], errors: [], failedResources: [] }; let page;
try {
  page = await browser.newPage({ viewport: { width: 390, height: 844 } }); collectBrowserEvidence(page, evidence);
  await begin(page); await openTerminal(page);
  await expect(page.locator('.game-header')).toHaveCount(1);
  await expect(page.locator('.game-footer')).toBeVisible();
  await expect(page.locator('.sound-caption')).toBeVisible();
  await expect(page.locator('.emergency-bar')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Survival resources' })).toBeVisible();
  evidence.mobileResources = await resources(page);
  const dangerUncovered = await page.getByRole('meter', { name: 'Danger value', exact: true }).evaluate(node => {
    const bounds = node.getBoundingClientRect();
    const top = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return !!top && (node === top || node.contains(top));
  });
  if (!dangerUncovered) throw Error('The visible danger meter is covered by another mobile panel');
  await page.screenshot({ path: 'artifacts/harder-mobile-inspection.png' });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Mobile horizontal overflow');
  await page.keyboard.press('q');
  await expect(page.getByRole('dialog', { name: 'Research terminal' })).toHaveCount(0);
  evidence.checks.push('Mobile inspection, captions and emergency controls fit; Q exits equipment inspection');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Camera and pulse settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Camera settings' })).toBeVisible();
  await page.keyboard.press('e');
  await expect(page.getByRole('dialog', { name: 'Research terminal' })).toHaveCount(0);
  await page.getByLabel('Camera device', { exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Camera settings' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Game paused' })).toHaveCount(0);
  evidence.checks.push('Camera settings blocks gameplay input; Escape closes it and resumes even with the camera SELECT focused');
  await page.keyboard.press('j');
  await page.getByLabel('Consent to sanitized trace sharing').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Game paused' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume protocol →' }).click();
  await page.getByRole('button', { name: 'Close ×', exact: true }).click();
  evidence.checks.push('Escape remains global while a judge checkbox has focus');
  await endOfIsolation(page);
  await page.getByRole('button', { name: '02 Look at monitor' }).click();
  await expect(page.getByRole('button', { name: 'CAM B SERVICE PATH' })).toHaveCount(0);
  await page.keyboard.press('e');
  await page.getByRole('button', { name: 'CAM B SERVICE PATH' }).click();
  await expect(page.getByRole('heading', { name: 'SERVICE PATH', exact: true })).toBeVisible();
  await expect(page.getByTestId('radar')).toBeVisible();
  await expect(page.getByTestId('radar-dot')).toBeVisible({ timeout: 6000 });
  evidence.radarContact = await page.getByTestId('radar').getAttribute('aria-label');
  await page.screenshot({ path: 'artifacts/harder-camera-b.png' });
  await page.getByRole('button', { name: 'CAM C FACILITY' }).click();
  await expect(page.getByRole('heading', { name: 'FACILITY', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/harder-camera-c.png' });
  // Navigating to equipment does not need another scarce isolation charge.
  await page.getByRole('button', { name: '03 Turn around' }).click();
  await page.keyboard.press('e');
  await expect(page.getByRole('heading', { name: 'A quieter room.', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/harder-equipment.png' });
  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { name: 'A quieter room.', exact: true })).toHaveCount(0);
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Laptop horizontal overflow');
  evidence.checks.push('Monitor B/C and isolation equipment require explicit use; Space leaves inspection');
  await openTerminal(page);
  const wireHeading = page.getByRole('heading', { name: 'Reconnect the relay.', exact: true });
  const wireDeadline = Date.now() + 90000;
  while (!await wireHeading.isVisible() && Date.now() < wireDeadline) {
    await guardDanger(page); await openTerminal(page);
    await fixFaultByEar(page);
  }
  await expect(wireHeading).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cable ▲', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/survival-wires-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Socket ■', exact: true })).toBeVisible();
  const wireDangerUncovered = await page.getByRole('meter', { name: 'Danger value', exact: true }).evaluate(node => {
    const bounds = node.getBoundingClientRect();
    const top = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return !!top && (node === top || node.contains(top));
  });
  if (!wireDangerUncovered) throw Error('The taller wire puzzle covers the mobile danger meter');
  await page.screenshot({ path: 'artifacts/survival-wires-mobile.png' });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Wire puzzle causes mobile horizontal overflow');
  evidence.checks.push('Actual stage-one wiring board rendered at laptop and mobile sizes after six faults found by ear; mobile danger meter remains uncovered');
  if (evidence.errors.length || evidence.failedResources.length) throw Error('Browser errors or missing resources');
  evidence.passed = true;
} catch (error) {
  evidence.failure = String(error); process.exitCode = 1;
  if (page) { await page.screenshot({ path: 'artifacts/harder-layout-failure.png' }); evidence.visibleTextAtFailure = await page.locator('body').innerText(); }
} finally { await writeFile('artifacts/harder-layout-evidence.json', JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence)); await browser.close(); }
