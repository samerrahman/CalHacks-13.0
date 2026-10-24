import { expect } from '@playwright/test';
export const TEST_URL = process.env.LOCK_IN_TEST_URL ?? 'http://127.0.0.1:5180';
const trace = process.env.LOCK_IN_DEBUG ? (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts) : () => {};
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
  await page.getByRole('button', { name: 'Skip cutscene →' }).click();
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
  if (!Number.isInteger(remaining) || remaining < 0 || remaining > 5 || value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) throw Error(`Invalid visible survival resources: ${JSON.stringify(result)}`);
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
  await endOfIsolation(page);
  await expect(quiet).toBeDisabled();
  data.defenses++;
  if (reopen) await openTerminal(page);
  return true;
}
/** Isolation ends on its own; a blackout can begin right after it, which F restores for free. */
async function endOfIsolation(page) {
  const quiet = page.locator('[data-tutorial="emergency-quiet"]');
  await expect(quiet).not.toHaveClass(/active/, { timeout: 16000 });
  evidenceFor(page).automaticRestores++;
  if (await page.locator('[data-tutorial="emergency-restore"]').isEnabled()) { evidenceFor(page).blackouts++; await restore(page); }
}
/** Read only player-visible sound captions and equipment controls. */
export async function guardDanger(page) {
  if (await page.locator('.jump-scare.breach').isVisible() || await page.getByRole('heading', { name: 'The shelter fell silent.', exact: true }).isVisible()) throw Error('Lost during early-defense playthrough');
  const caption = await page.locator('.sound-caption').innerText();
  if (/METAL STRAINING — HEAVY IMPACTS/.test(caption)) throw Error('Defense was late: committed impact sound reached the shelter');
  const quiet = page.locator('[data-tutorial="emergency-quiet"]');
  if (await page.locator('[data-tutorial="emergency-restore"]').isEnabled()) {
    if (/active/.test(await quiet.getAttribute('class') ?? '')) {
      await endOfIsolation(page);
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
/** Match only the symbols visible on the current five-cable panel. A real mouse drag
 * exercises pointer capture; remaining cables exercise the accessible clicks. */
export async function connectWires(page) {
  const data = evidenceFor(page), terminal = page.getByRole('dialog', { name: 'Research terminal' });
  const heading = terminal.getByRole('heading', { name: 'Reconnect the relay.', exact: true });
  await expect(heading).toBeVisible();
  while (await heading.count()) {
    await guardDanger(page); await openTerminal(page);
    const cable = terminal.locator('.wire-column').first().locator('button:not([disabled])').first();
    if (!await cable.count()) { await page.waitForTimeout(100); continue; }
    const symbol = (await cable.getAttribute('aria-label')).replace('Cable ', '');
    const socket = terminal.locator('[data-wire-target]:not([disabled])', { hasText: symbol }).first();
    await expect(socket).toBeEnabled();
    const linked = await terminal.locator('.task-progress').first().innerText();
    if (data.wireDrags === 0) {
      const from = await cable.boundingBox(), to = await socket.boundingBox();
      if (!from || !to) throw Error('Visible wire drag targets have no bounds');
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 14 });
      await page.mouse.up(); data.wireDrags++;
    } else { await cable.click(); await socket.click(); data.wireClicks++; }
    await expect.poll(async () => await heading.count() ? await terminal.locator('.task-progress').first().innerText() : 'done').not.toBe(linked);
  }
  data.wireBoards++;
}
/** Read the visible machine ratings and add them up, as a player would. */
export async function routePower(page) {
  const data = evidenceFor(page), terminal = page.getByRole('dialog', { name: 'Research terminal' });
  const copy = await terminal.innerText();
  const limit = Number(/louder than (\d+)/.exec(copy)?.[1]), required = Number(/at least (\d+) power/.exec(copy)?.[1]);
  const machines = terminal.locator('.routing-grid button'), ratings = [];
  for (let i = 0; i < 4; i++) { const text = await machines.nth(i).innerText(); const [, power, noise] = /POWER (\d+) · NOISE (\d+)/.exec(text.replace(/\s+/g, ' ')) ?? []; ratings.push({ power: Number(power), noise: Number(noise), on: await machines.nth(i).getAttribute('aria-pressed') === 'true' }); }
  if (!Number.isFinite(limit) || !Number.isFinite(required) || ratings.some(r => !Number.isFinite(r.power))) throw Error('Routing ratings are not visible');
  const answer = Array.from({ length: 15 }, (_, i) => i + 1).find(bits => ratings.reduce((sum, r, i) => bits & 1 << i ? sum + r.power : sum, 0) >= required && ratings.reduce((sum, r, i) => bits & 1 << i ? sum + r.noise : sum, 0) <= limit);
  if (!answer) throw Error('No visible routing answer');
  for (let i = 0; i < 4; i++) if (!!(answer & 1 << i) !== ratings[i].on) await machines.nth(i).click();
  await guardDanger(page); await openTerminal(page);
  await terminal.getByRole('button', { name: 'T Engage relay', exact: true }).click();
  data.routes = (data.routes ?? 0) + 1;
}
/** Time the visible false pulse, then tap 1 at that rhythm. */
export async function maskHeartbeat(page) {
  const data = evidenceFor(page), pad = page.getByRole('button', { name: 'Tap the false heartbeat' });
  await expect(pad).toBeVisible();
  const peaks = await pad.evaluate(async element => {
    const seen = []; let previous = 0; const end = performance.now() + 5200;
    while (performance.now() < end) { const value = Number(getComputedStyle(element).getPropertyValue('--beat')); if (value > .5 && previous <= .5) seen.push(performance.now()); previous = value; await new Promise(resolve => requestAnimationFrame(resolve)); }
    return seen;
  });
  if (peaks.length < 3) throw Error('Could not see the false pulse');
  const period = (peaks.at(-1) - peaks[0]) / (peaks.length - 1);
  const need = Number(/\/ (\d+) beats in rhythm/.exec(await page.getByTestId('pulse-streak').innerText())?.[1] ?? 8);
  await page.evaluate(async ({ period, taps }) => {
    for (let i = 0; i < taps; i++) { window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' })); window.dispatchEvent(new KeyboardEvent('keyup', { key: '1' })); await new Promise(resolve => setTimeout(resolve, period)); }
  }, { period, taps: need + 2 });
  data.pulsePeriods = [...(data.pulsePeriods ?? []), Math.round(period)]; data.pulseBeatsNeeded = [...(data.pulseBeatsNeeded ?? []), need];
}
/** Use the security monitor's visible range reading to mark the creature's sector. */
export async function locateCreature(page) {
  const data = evidenceFor(page);
  await page.getByRole('button', { name: '02 Look at monitor' }).click(); await page.keyboard.press('e');
  const panel = page.getByTestId('locate-panel');
  while (await panel.count()) {
    if (await guardDanger(page)) { await page.getByRole('button', { name: '02 Look at monitor' }).click(); await page.keyboard.press('e'); continue; }
    const first = panel.locator('button').first();
    if (await first.isDisabled()) { await page.waitForTimeout(150); continue; }
    const reading = Number(await page.getByTestId('sampled-distance').innerText());
    if (!Number.isFinite(reading)) { await page.waitForTimeout(150); continue; }
    const key = reading < 7 ? '1' : reading <= 14 ? '2' : reading <= 22 ? '3' : '4';
    await page.keyboard.press(key); data.marks = (data.marks ?? 0) + 1;
    await page.waitForTimeout(250);
  }
  await page.getByRole('button', { name: '01 Look at terminal' }).click();
}
/** Follow the visible breathing pacer with the B key. */
export async function holdCalm(page) {
  const terminal = page.getByRole('dialog', { name: 'Research terminal' }), heading = terminal.getByRole('heading', { name: 'Let it lose your trail.', exact: true });
  let holding = false; const end = Date.now() + 120000;
  while (await heading.count() && Date.now() < end) {
    const caption = await page.locator('.sound-caption').innerText();
    if (/PROXIMITY ALARM/.test(caption) || await page.locator('[data-tutorial="emergency-restore"]').isEnabled()) { if (holding) { await page.keyboard.up('b'); holding = false; } await guardDanger(page); await openTerminal(page); continue; }
    const label = await terminal.locator('.calm-ring span').innerText().catch(() => '');
    const inhale = label.startsWith('BREATHE IN');
    if (inhale && !holding) { await page.keyboard.down('b'); holding = true; }
    if (!inhale && holding) { await page.keyboard.up('b'); holding = false; }
    await page.waitForTimeout(60);
  }
  if (holding) await page.keyboard.up('b');
  evidenceFor(page).calmHolds = (evidenceFor(page).calmHolds ?? 0) + 1;
}
export async function watchSequence(page, { tutorial = false, retry = 0 } = {}) {
  await openTerminal(page);
  const copy = await page.getByRole('dialog', { name: 'Research terminal' }).innerText();
  const expected = Number(/watch (\d+) pulses/i.exec(copy)?.[1]);
  if (!(expected >= 3 && expected <= 8)) throw Error('Visible sequence length missing from terminal instructions');
  await page.getByRole('button', { name: 'Replay sequence' }).click();
  const digits = []; let last = ''; const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (!tutorial && await guardDanger(page)) continue;
    const cueNode = page.getByTestId('memory-cue');
    if (!await cueNode.count()) break;
    // Playback can end between the count and the read; a missing node means it is over.
    const text = await cueNode.textContent({ timeout: 250 }).catch(() => null);
    if (text === null) break;
    const cue = text.trim();
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
  if (tutorial) await expect(page.getByRole('button', { name: 'T Transmit', exact: true })).toBeEnabled();
  evidenceFor(page).sequenceLengths.push(expected);
  return digits;
}
export async function solve(page, { delayStageThree = false } = {}) {
  let delayed = false; const end = Date.now() + 760000; const data = evidenceFor(page);
  while (Date.now() < end) {
    if (await page.getByRole('dialog', { name: 'Run results' }).getByRole('heading', { name: 'Containment confirmed.', exact: true }).isVisible()) return data.stages;
    // Winning hides inspection shortly before the result modal; wait for that transition.
    if (/CONTAINMENT COMPLETE/.test(await page.locator('.sound-caption').innerText())) { await page.waitForTimeout(100); continue; }
    await guardDanger(page); await openTerminal(page);
    const title = await page.getByRole('dialog', { name: 'Research terminal' }).locator('h2').innerText();
    if (!data.stages.includes(title)) { data.stages.push(title); console.log('stage:', title); }
    trace('solve', title, await page.getByTestId('run-deadline').innerText(), (await page.locator('.sound-caption').innerText()).split('\n')[0]);
    if (delayStageThree && !delayed && title === 'Clear the overload.') {
      delayed = true; const until = Date.now() + 90000;
      while (Date.now() < until && data.blackouts === 0) { await guardDanger(page); await page.waitForTimeout(100); }
      if (!data.blackouts) throw Error('No visible blackout occurred during the bounded stage-three observation');
      continue;
    }
    if (title === 'Reconnect the relay.') { await connectWires(page); continue; }
    if (title === 'Route power quietly.') { await routePower(page); continue; }
    if (title === 'Mark its position.') { await locateCreature(page); continue; }
    if (title === 'Mask your heartbeat.') { await maskHeartbeat(page); continue; }
    if (title === 'Let it lose your trail.') { await holdCalm(page); continue; }
    const faults = page.getByRole('button', { name: /^Machine [1-4] FAULT$/ });
    if (await faults.count()) { await faults.first().click(); await page.waitForTimeout(70); continue; }
    if (title === 'Transmit a false heartbeat.' || title === 'Lead it toward containment.') {
      const transmit = page.getByRole('button', { name: 'T Transmit', exact: true });
      if (await transmit.isEnabled()) { await guardDanger(page); await transmit.click(); continue; }
      await watchSequence(page); continue;
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
