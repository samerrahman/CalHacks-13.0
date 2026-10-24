import { expect } from '@playwright/test';
export const TEST_URL = process.env.LOCK_IN_TEST_URL ?? 'http://127.0.0.1:5180';
const observations = new WeakMap();
export function evidenceFor(page) { if (!observations.has(page)) observations.set(page, { defenses: 0, automaticRestores: 0, blackouts: 0, sequenceLengths: [], wireBoards: 0, wireDrags: 0, wireClicks: 0, stages: [], resourceSamples: [] }); return observations.get(page); }
export async function begin(page, { tutorial = false, seed = 17, simulated = false, record = false, calibrate = false } = {}) {
  await page.goto(TEST_URL);
  await expect(page.getByRole('button', { name: 'Begin with guidance' })).toBeEnabled({ timeout: 20000 });
  await page.getByRole('button', { name: 'Operator settings' }).click();
  await page.getByLabel('Encounter seed').fill(String(seed));
  await page.getByLabel('Reduced motion', { exact: true }).check();
  if (simulated) await page.getByLabel('Pulse input', { exact: true }).selectOption('simulated');
  if (record) await page.getByLabel('Record accepted pulse locally for this run’s report').check();
  if (simulated && calibrate) {
    // The visible baseline progress disappears only after the simulated
    // calibration completes. Keep this out of the five-minute game clock.
    await expect(page.locator('.sensor-setup progress')).toBeVisible();
    await expect(page.locator('.sensor-setup progress')).toHaveCount(0, { timeout: 45000 });
    evidenceFor(page).calibratedBeforeRun = true;
  }
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
  if (!await button.isEnabled()) return;
  await expect(button).toHaveClass(/ready/, { timeout: 20000 });
  await page.keyboard.down('f');
  try { await expect(button).toBeDisabled({ timeout: 3000 }); }
  finally { await page.keyboard.up('f'); }
}
export async function resources(page) {
  const remaining = Number((await page.locator('.isolation-reserve b').innerText()).split('/')[0].trim());
  const danger = page.getByRole('meter', { name: 'Danger value', exact: true });
  const value = await danger.count() ? Number(await danger.getAttribute('aria-valuenow')) : null;
  const result = { cells: remaining, danger: value, deadline: await page.getByTestId('run-deadline').innerText() };
  if (!Number.isInteger(remaining) || remaining < 0 || remaining > 4 || value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) throw Error(`Invalid visible survival resources: ${JSON.stringify(result)}`);
  evidenceFor(page).resourceSamples.push(result);
  return result;
}
export async function defend(page, { reopen = true } = {}) {
  const data = evidenceFor(page);
  if (await page.locator('.jump-scare.breach').isVisible() || await page.getByRole('heading', { name: 'The shelter fell silent.', exact: true }).isVisible()) throw Error('A committed attack reached the loss state before early defense');
  const quiet = page.locator('[data-tutorial="emergency-quiet"]');
  if (!await quiet.isEnabled()) return false;
  const before = await resources(page);
  await page.keyboard.press('q');
  await expect(page.getByRole('dialog', { name: 'Research terminal' })).toHaveCount(0);
  await expect(quiet).toHaveClass(/active/);
  const after = await resources(page);
  if (after.cells !== before.cells - 1) throw Error('One isolation did not consume exactly one visible cell');
  await expect(page.locator('[data-tutorial="emergency-restore"]')).toBeDisabled({ timeout: 13000 });
  await expect(quiet).not.toHaveClass(/active/);
  await expect(quiet).toBeDisabled();
  data.defenses++; data.automaticRestores++;
  if (reopen) await openTerminal(page);
  return true;
}
/** Read only player-visible sound captions and equipment controls. */
export async function guardDanger(page) {
  if (await page.locator('.jump-scare.breach').isVisible() || await page.getByRole('heading', { name: 'The shelter fell silent.', exact: true }).isVisible()) throw Error('Lost during early-defense playthrough');
  const caption = await page.locator('.sound-caption').innerText();
  if (/METAL STRAINING — HEAVY IMPACTS/.test(caption)) throw Error('Defense was late: committed impact sound reached the shelter');
  const quiet = page.locator('[data-tutorial="emergency-quiet"]');
  if (await page.locator('[data-tutorial="emergency-restore"]').isEnabled()) {
    if (/active/.test(await quiet.getAttribute('class') ?? '')) {
      await expect(page.locator('[data-tutorial="emergency-restore"]')).toBeDisabled({ timeout: 13000 });
      evidenceFor(page).automaticRestores++;
    } else {
      evidenceFor(page).blackouts++;
      await restore(page); // A blackout costs no isolation cell.
    }
    await openTerminal(page); return true;
  }
  if (/PROXIMITY ALARM/.test(caption) && await quiet.isEnabled()) {
    const defended = await defend(page);
    if (defended) {
      const data = evidenceFor(page);
      data.naturalAlarmDefenses = (data.naturalAlarmDefenses ?? 0) + 1;
    }
    return defended;
  }
  return false;
}
/** Match only the symbols visible on the rendered board. A real mouse drag
 * exercises pointer capture; remaining cables exercise the accessible clicks. */
export async function connectWires(page) {
  const data = evidenceFor(page), terminal = page.getByRole('dialog', { name: 'Research terminal' });
  await expect(terminal.getByRole('heading', { name: 'Reconnect the relay.', exact: true })).toBeVisible();
  for (const symbol of ['▲', '●', '◆', '■']) {
    await guardDanger(page); await openTerminal(page);
    const cable = terminal.getByRole('button', { name: `Cable ${symbol}`, exact: true });
    const socket = terminal.getByRole('button', { name: `Socket ${symbol}`, exact: true });
    await expect(cable).toBeEnabled(); await expect(socket).toBeEnabled();
    if (data.wireDrags === 0) {
      const from = await cable.boundingBox(), to = await socket.boundingBox();
      if (!from || !to) throw Error('Visible wire drag targets have no bounds');
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 14 });
      await page.mouse.up(); data.wireDrags++;
    } else { await cable.click(); await socket.click(); data.wireClicks++; }
    if (symbol !== '■') await expect(terminal.getByRole('button', { name: `Cable ${symbol} connected`, exact: true })).toBeDisabled();
  }
  await expect(terminal.getByRole('heading', { name: 'Reconnect the relay.', exact: true })).toHaveCount(0);
  data.wireBoards++;
}
export async function watchSequence(page, { tutorial = false, retry = 0 } = {}) {
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
  if (digits.length !== expected) {
    if (retry >= 2) throw Error(`Observed ${digits.length} visible pulses; terminal asked for ${expected} after three visible replays`);
    // A browser render/poll can miss a short dark gap. Use the same free replay
    // available to a player; never infer the missing input from simulation data.
    const data = evidenceFor(page); data.incompleteObservationReplays = (data.incompleteObservationReplays ?? 0) + 1;
    if (!tutorial) await guardDanger(page);
    return watchSequence(page, { tutorial, retry: retry + 1 });
  }
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
      delayed = true; const until = Date.now() + 90000;
      while (Date.now() < until && data.blackouts === 0) { await guardDanger(page); await page.waitForTimeout(100); }
      if (!data.blackouts) throw Error('No visible blackout occurred during the bounded stage-three observation');
      continue;
    }
    if (title === 'Reconnect the relay.') { await connectWires(page); continue; }
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
