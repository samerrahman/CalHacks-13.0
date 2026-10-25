import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { TEST_URL } from './hush-browser-helpers.mjs';

// The real ending film through the component App uses after a win: it loads, plays, shows the
// timeline's captions at the right moments, and Skip hands over to the run report.
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const evidence = { passed: false, url: `${TEST_URL}/tests/fixtures/ending.html`, checks: [], errors: [], failedResources: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => evidence.errors.push(String(error)));
  page.on('response', response => { if (response.status() >= 400) evidence.failedResources.push({ url: response.url(), status: response.status() }); });
  await page.goto(evidence.url);
  const film = page.getByRole('main', { name: 'Ending cutscene' }), video = film.locator('video');
  await expect.poll(() => video.evaluate(v => v.readyState), { timeout: 20000 }).toBeGreaterThanOrEqual(2);
  const info = await video.evaluate(v => ({ duration: v.duration, width: v.videoWidth, height: v.videoHeight }));
  assert.ok(Math.abs(info.duration - 38.5) < 0.2 && info.width === 640 && info.height === 360, `unexpected video ${JSON.stringify(info)}`);
  const started = await video.evaluate(v => v.currentTime); await page.waitForTimeout(800);
  assert.ok(await video.evaluate(v => v.currentTime) > started, 'the ending must play');
  evidence.checks.push(`ending.mp4 loads and plays (${info.width}×${info.height}, ${info.duration.toFixed(1)} s)`);
  for (const [at, text] of [[3, '[the basement door motor grinds — loud]'], [12.4, '[it slams into the shelter door]'], [21.7, '[you drop the basement door on its claws]'], [35, 'You escaped.']]) {
    await video.evaluate((v, t) => { v.pause(); v.currentTime = t; }, at);
    await expect(film.locator('.opening-caption')).toHaveText(text);
    await page.screenshot({ path: `artifacts/ending-${String(at).replace('.', '_')}s.png` });
  }
  evidence.checks.push('Captions follow the ending timeline: motor, the shelter door, the slam, You escaped.');
  const box = await film.boundingBox();
  assert.ok(box && box.width === 1280 && box.height === 720, 'the ending covers the viewport');
  assert.equal(await film.evaluate(el => getComputedStyle(el).zIndex), '15');
  await film.getByRole('button', { name: 'Skip cutscene →' }).click();
  await expect(page.getByTestId('ending-state')).toHaveText('Ending finished: run report would show');
  evidence.checks.push('Skip ends the film and hands over to the run report');
  if (evidence.errors.length || evidence.failedResources.length) throw Error('Fixture errors or missing resources');
  evidence.passed = true;
} catch (error) {
  evidence.failure = String(error); process.exitCode = 1;
} finally {
  await writeFile('artifacts/ending-evidence.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence)); await browser.close();
}
