import { expect } from '@playwright/test';
export const TEST_URL = process.env.LOCK_IN_TEST_URL ?? 'http://127.0.0.1:5180';
const observations = new WeakMap();
export function evidenceFor(page) { if (!observations.has(page)) observations.set(page, { defenses: 0, blackouts: 0, sequenceLengths: [], stages: [], alarmSeenAt: null }); return observations.get(page); }
export async function begin(page, { tutorial = false, seed = 17, simulated = false, record = false } = {}) {
  await page.goto(TEST_URL);
  await expect(page.getByRole('button', { name: 'Begin with guidance' })).toBeEnabled({ timeout: 20000 });
  await page.getByRole('button', { name: 'Operator settings' }).click();
  await page.getByLabel('Encounter seed').fill(String(seed));
  await page.getByLabel('Reduced motion', { exact: true }).check();
  if (simulated) await page.getByLabel('Pulse input', { exact: true }).selectOption('simulated');
  if (record) await page.getByLabel('Record accepted pulse locally for this run’s report').check();
  await page.getByRole('button', { name: tutorial ? 'Begin with guidance' : 'Skip guidance & start' }).click();
  await page.getByRole('button', { name: 'Skip opening →' }).click();
  await expect(page.getByRole('button', { name: 'Use terminal' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Research terminal' })).toHaveCount(0);
  evidenceFor(page);
}
export async function openTerminal(page) {
  if (await page.getByRole('dialog', { name: 'Research terminal' }).isVisible()) return;
  await page.getByRole('button', { name: '01 Look at terminal' }).click();
  await page.keyboard.press('e');
  await expect(page.getByRole('dialog', { name: 'Research terminal' })).toBeVisible();
}
export async function restore(page) {
  const button = page.locator('[data-tutorial="emergency-restore"]');
  await expect(button).toHaveClass(/ready/, { timeout: 20000 });
  await page.keyboard.down('f');
  try { await expect(button).toBeDisabled({ timeout: 3000 }); }
  finally { await page.keyboard.up('f'); }
}
export async function defend(page, { reopen = true } = {}) {
  const data = evidenceFor(page);
  const caption = await page.locator('.sound-caption').innerText();
  if (/POWER LOST|Power lost|Main power lost/i.test(caption)) data.blackouts++;
  if (await page.locator('.jump-scare.breach').isVisible() || await page.getByRole('heading', { name: 'The shelter fell silent.', exact: true }).isVisible()) throw Error('A committed attack reached the loss state before early defense');
  await page.keyboard.press('q');
  await expect(page.getByRole('dialog', { name: 'Research terminal' })).toHaveCount(0);
  await expect(page.locator('.sound-caption')).toContainText('RESTORE WINDOW', { timeout: 20000 });
  await restore(page);
  data.defenses++; data.alarmSeenAt = null;
  if (reopen) await openTerminal(page);
}
/** Read only player-visible sound captions and equipment controls. */
export async function guardDanger(page) {
  const data = evidenceFor(page);
  if (await page.locator('.jump-scare.breach').isVisible() || await page.getByRole('heading', { name: 'The shelter fell silent.', exact: true }).isVisible()) throw Error('Lost during early-defense playthrough');
  const caption = await page.locator('.sound-caption').innerText();
  if (/METAL STRAINING — HEAVY IMPACTS/.test(caption)) throw Error('Defense was late: committed impact sound reached the shelter');
  if (await page.locator('[data-tutorial="emergency-restore"]').isEnabled()) { await defend(page); return true; }
  if (/PROXIMITY ALARM — MOVEMENT CLOSING IN/.test(caption)) {
    data.alarmSeenAt ??= Date.now();
    // A brief reaction interval reaches roughly8–9m, still well outside4.2m.
    if (Date.now() - data.alarmSeenAt >= 600) { await defend(page); return true; }
  } else data.alarmSeenAt = null;
  return false;
}
export async function watchSequence(page, { tutorial = false } = {}) {
  await openTerminal(page);
  const copy = await page.getByRole('dialog', { name: 'Research terminal' }).innerText();
  const expected = Number(/Watch (\d+) pulses/.exec(copy)?.[1]);
  if (![4, 5, 6].includes(expected)) throw Error('Visible sequence length missing from terminal instructions');
  await page.getByRole('button', { name: 'Replay sequence' }).click();
  const digits = []; let last = ''; const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (!tutorial && await guardDanger(page)) continue;
    const cueNode = page.getByTestId('memory-cue');
    if (!await cueNode.count()) break;
    const cue = (await cueNode.textContent())?.trim() ?? '';
    if (cue !== last && /^[1-4]$/.test(cue)) digits.push(cue);
    last = cue;
    await page.waitForTimeout(45);
  }
  if (digits.length !== expected) throw Error(`Observed ${digits.length} visible pulses; terminal asked for ${expected}`);
  for (const digit of digits) {
    if (!tutorial) await guardDanger(page);
    await page.getByRole('button', { name: `Sequence digit ${digit}`, exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'T Transmit', exact: true })).toBeEnabled();
  evidenceFor(page).sequenceLengths.push(expected);
  return digits;
}
export async function solve(page, { delayStageThree = false } = {}) {
  let delayed = false; const end = Date.now() + 330000; const data = evidenceFor(page);
  while (Date.now() < end) {
    if (await page.getByRole('dialog', { name: 'Run results' }).getByRole('heading', { name: 'Containment confirmed.', exact: true }).isVisible()) return data.stages;
    // Winning hides inspection shortly before the result modal; wait for that transition.
    if (/CONTAINMENT COMPLETE/.test(await page.locator('.sound-caption').innerText())) { await page.waitForTimeout(100); continue; }
    await guardDanger(page); await openTerminal(page);
    const title = await page.getByRole('dialog', { name: 'Research terminal' }).locator('h2').innerText();
    if (!data.stages.includes(title)) { data.stages.push(title); console.log('stage:', title); }
    if (delayStageThree && !delayed && title === 'Clear the overload.') {
      delayed = true; const until = Date.now() + 65000;
      while (Date.now() < until) { await guardDanger(page); await page.waitForTimeout(100); }
      continue;
    }
    const faults = page.getByRole('button', { name: /^Machine [1-4] FAULT$/ });
    if (await faults.count()) { await faults.first().click(); await page.waitForTimeout(70); continue; }
    if (title === 'Transmit a false heartbeat.' || title === 'Lead it toward containment.') {
      await watchSequence(page); await guardDanger(page);
      await page.getByRole('button', { name: 'T Transmit', exact: true }).click(); continue;
    }
    const final = page.getByRole('button', { name: 'Final containment broadcast' });
    if (await final.isVisible()) { await final.click(); continue; }
    await page.waitForTimeout(100);
  }
  throw Error('Playthrough deadline exceeded');
}
export function collectBrowserEvidence(page, evidence) {
  page.on('pageerror', error => evidence.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') evidence.errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) evidence.failedResources.push({ url: response.url(), status: response.status() }); });
}
