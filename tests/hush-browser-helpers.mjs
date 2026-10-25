import { expect } from '@playwright/test';
/** Captions that describe the creature close to the wall: the cue a player acts on. */
export const CLOSE_CAPTION = /HEAVY FOOTSTEPS CLOSE|FOOTSTEPS RIGHT OUTSIDE|POUNDING ON THE WALL/;
export const TEST_URL = process.env.HUSH_TEST_URL ?? 'http://127.0.0.1:5180';
/** The judge trace panel these checks read is a developer tool shown only with ?debug. */
export const withDebug = url => { const u = new URL(url); u.searchParams.set('debug', '1'); return u.href; };
const trace = process.env.HUSH_DEBUG ? (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts) : () => {};
const observations = new WeakMap();
export function evidenceFor(page) { if (!observations.has(page)) observations.set(page, { defenses: 0, automaticRestores: 0, blackouts: 0, sequenceLengths: [], wireBoards: 0, wireDrags: 0, wireClicks: 0, stages: [], resourceSamples: [] }); return observations.get(page); }
export async function begin(page, { tutorial = false, seed = 17, simulated = false, calibrate = false } = {}) {
  await page.goto(withDebug(TEST_URL));
  await expect(page.getByRole('button', { name: 'Begin with guidance' })).toBeEnabled({ timeout: 20000 });
  await page.getByRole('button', { name: 'Operator settings' }).click();
  await page.getByLabel('Encounter seed').fill(String(seed));
  await page.getByLabel('Reduced motion', { exact: true }).check();
  if (simulated) await page.getByLabel('Pulse input', { exact: true }).selectOption('simulated');
  if (simulated && calibrate) {
    // The visible baseline progress disappears only after the simulated
    // calibration completes. Keep this out of the five-minute game clock.
    await expect(page.locator('.sensor-setup progress')).toBeVisible();
    await expect(page.locator('.sensor-setup progress')).toHaveCount(0, { timeout: 45000 });
    evidenceFor(page).calibratedBeforeRun = true;
  }
  await page.getByRole('button', { name: tutorial ? 'Begin with guidance' : 'Skip guidance & start' }).click();
  if (!simulated) {
    // A fresh session asks for the camera before the first run; these runs play with neutral physiology.
    const prompt = page.getByRole('dialog', { name: 'Enable your camera' });
    await expect(prompt.getByRole('button', { name: /Enable camera & set up Presage/ })).toBeVisible();
    await prompt.getByRole('button', { name: 'I don’t want to turn on my camera' }).click();
    evidenceFor(page).cameraPrompt = 'declined';
  }
  await page.getByRole('button', { name: 'Skip cutscene →' }).click();
  await expect(page.getByRole('button', { name: 'Use terminal' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Research terminal' })).toHaveCount(0);
  evidenceFor(page);
}
export async function openTerminal(page) {
  const dialog = page.getByRole('dialog', { name: 'Research terminal' }), off = page.locator('[data-tutorial="emergency-restore"]');
  // Power can drop between any two actions; bring it back the way a player would, then reopen.
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await dialog.isVisible()) return;
    if (await off.isEnabled()) {
      if (/active/.test(await page.locator('[data-tutorial="emergency-quiet"]').getAttribute('class') ?? '')) await endOfIsolation(page);
      else { evidenceFor(page).blackouts++; await restore(page); }
    }
    await page.getByRole('button', { name: '01 Look at terminal' }).click();
    await page.keyboard.press('e');
    try { await expect(dialog).toBeVisible({ timeout: 2500 }); return; } catch { /* power dropped again; retry */ }
  }
  await expect(dialog).toBeVisible();
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
  if (!Number.isInteger(remaining) || remaining < 0 || remaining > 3 || value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) throw Error(`Invalid visible survival resources: ${JSON.stringify(result)}`);
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
/** The player ends isolation: once the restore window opens and the footsteps are no longer close,
 * hold F (otherwise it ends by itself at the cap). A blackout can follow, which F restores for free. */
export async function endOfIsolation(page) {
  const quiet = page.locator('[data-tutorial="emergency-quiet"]'), restoreButton = page.locator('[data-tutorial="emergency-restore"]'), end = Date.now() + 30000;
  while (/active/.test(await quiet.getAttribute('class') ?? '') && Date.now() < end) {
    const caption = await page.locator('.sound-caption').innerText().catch(() => '');
    if (/ready/.test(await restoreButton.getAttribute('class') ?? '') && !CLOSE_CAPTION.test(caption) && !/RUNNING FOOTSTEPS/.test(caption)) {
      await page.keyboard.down('f'); await page.waitForTimeout(1250); await page.keyboard.up('f'); evidenceFor(page).manualRestores = (evidenceFor(page).manualRestores ?? 0) + 1;
    } else await page.waitForTimeout(150);
  }
  await expect(quiet).not.toHaveClass(/active/, { timeout: 30000 });
  evidenceFor(page).automaticRestores++;
  if (await restoreButton.isEnabled()) { evidenceFor(page).blackouts++; await restore(page); }
}
/** Read only player-visible sound captions and equipment controls. */
export async function guardDanger(page) {
  if (await page.locator('.jump-scare.breach').isVisible() || await page.getByRole('heading', { name: 'The shelter fell silent.', exact: true }).isVisible()) throw Error('Lost during early-defense playthrough');
  const caption = await page.locator('.sound-caption').innerText();
  if (/IT IS BREAKING IN/.test(caption)) throw Error('Defense was late: the committed attack reached the shelter');
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
  if (CLOSE_CAPTION.test(caption) && await quiet.isEnabled()) {
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
/** Faults by ear, played the way a deaf player can: learn the number for each sound while the
 * rack key names it on the buttons, then match the YOU HEAR caption. */
export async function learnRackKey(page) {
  const data = evidenceFor(page), playing = page.locator('.listen-grid .machine.playing');
  if (!await playing.count()) return;
  const match = /^Machine (\d): (.+)$/.exec(await playing.getAttribute('aria-label').catch(() => '') ?? '');
  if (!match) return;
  if (match[1] === '1') data.faultKey = {}; // a new key always starts with machine 1
  (data.faultKey ??= {})[match[2]] = Number(match[1]);
}
export async function heardFaults(page) {
  const text = await page.getByTestId('fault-hearing').innerText({ timeout: 1000 }).catch(() => '');
  const heard = text.replace(/^YOU HEAR\s*/, '').trim();
  return heard && heard !== 'The rack key' && !heard.startsWith('Nothing') ? heard.split(' + ') : [];
}
export async function fixFaultByEar(page, { wrong = false } = {}) {
  const data = evidenceFor(page); await learnRackKey(page);
  const heard = await heardFaults(page);
  if (!heard.length) { await page.waitForTimeout(60); return false; }
  const key = data.faultKey ?? {}, known = heard.map(sound => key[sound]).filter(Boolean);
  if (!known.length) { await page.getByRole('button', { name: /Listen to the rack again/ }).click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(120); return false; }
  const machine = wrong ? [1, 2, 3, 4].find(n => !known.includes(n)) : known[0];
  await page.getByRole('button', { name: `Machine ${machine}`, exact: true }).click({ timeout: 2000 }).catch(() => {});
  if (!wrong) data.faultsByEar = (data.faultsByEar ?? 0) + 1;
  await page.waitForTimeout(70); return true;
}
/** Read each tile's drawn pipe openings, then search for a path from the inlet to the outlet. */
export async function solveConduit(page) {
  const data = evidenceFor(page);
  const board = await page.locator('.conduit').evaluate(element => {
    const rows = [...element.querySelectorAll('.conduit-row')], size = rows.length;
    const bits = { 'M20 20V0': 1, 'M20 20H40': 2, 'M20 20V40': 4, 'M20 20H0': 8 };
    const tiles = rows.flatMap(row => [...row.querySelectorAll('.conduit-tile')].map(tile => [...tile.querySelectorAll('path')].reduce((sum, path) => sum | (bits[path.getAttribute('d')] ?? 0), 0)));
    return { size, tiles, start: rows.findIndex(row => row.querySelector('.conduit-port.in')), end: rows.findIndex(row => row.querySelector('.conduit-port.out')) };
  });
  const rotate = bits => ((bits << 1) | (bits >> 3)) & 15, turns = bits => [0, 1, 2, 3].map(k => { let b = bits; for (let i = 0; i < k; i++) b = rotate(b); return b; });
  const steps = [[-1, 0, 1, 4], [0, 1, 2, 8], [1, 0, 4, 1], [0, -1, 8, 2]], { size, tiles, start, end } = board, plan = new Map();
  const walk = (cell, entry, seen) => {
    const row = Math.floor(cell / size), col = cell % size;
    for (const [k, open] of turns(tiles[cell]).entries()) {
      if (!(open & entry)) continue;
      if (cell === end * size + size - 1 && open & 2) { plan.set(cell, k); return true; }
      for (const [dr, dc, own, theirs] of steps) {
        const next = (row + dr) * size + col + dc;
        if (!(open & own) || own === entry || row + dr < 0 || col + dc < 0 || row + dr >= size || col + dc >= size || seen.has(next)) continue;
        seen.add(next); plan.set(cell, k);
        if (walk(next, theirs, seen)) return true;
        seen.delete(next); plan.delete(cell);
      }
    }
    return false;
  };
  if (!walk(start * size, 8, new Set([start * size]))) throw Error('No visible conduit solution');
  const buttons = page.locator('.conduit-tile');
  for (const [cell, k] of plan) for (let i = 0; i < k; i++) { await guardDanger(page); await openTerminal(page); await buttons.nth(cell).click({ timeout: 3000 }); }
  await guardDanger(page); await openTerminal(page);
  await page.getByRole('button', { name: 'T Engage relay', exact: true }).click({ timeout: 3000 });
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
  // A blackout can close the terminal while the pulse is being timed; the solve loop restores power and comes back.
  if (!(await pad.isVisible())) return;
  if (peaks.length < 3) throw Error('Could not see the false pulse');
  const period = (peaks.at(-1) - peaks[0]) / (peaks.length - 1);
  const streak = await page.getByTestId('pulse-streak').innerText({ timeout: 1500 }).catch(() => null);
  if (streak === null) return;
  const need = Number(/\/ (\d+) beats in rhythm/.exec(streak)?.[1] ?? 8);
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
    // Read the radar like a player: the contact's distance from the centre gives its band.
    const dot = page.getByTestId('radar-dot');
    if (!await dot.count()) { await page.waitForTimeout(150); continue; }
    const [x, y] = await Promise.all([dot.getAttribute('cx'), dot.getAttribute('cy')]);
    const reading = Math.hypot(Number(x) - 84, Number(y) - 84) / 74 * 24;
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
    if (CLOSE_CAPTION.test(caption) || await page.locator('[data-tutorial="emergency-restore"]').isEnabled()) { if (holding) { await page.keyboard.up('b'); holding = false; } await guardDanger(page); await openTerminal(page); continue; }
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
  if (!await page.getByRole('button', { name: 'Replay sequence' }).click({ timeout: 3000 }).then(() => true, () => false)) {
    if (retry >= 4) throw Error('Replay kept being interrupted');
    await guardDanger(page); await openTerminal(page); return watchSequence(page, { tutorial, retry: retry + 1 });
  }
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
    try { await page.getByRole('button', { name: `Sequence digit ${digit}`, exact: true }).click({ timeout: 3000 }); }
    catch {
      // A blackout or isolation interrupted entry: restore power, then replay and enter the round again.
      if (retry >= 4) throw Error('Sequence entry kept being interrupted');
      await guardDanger(page); await openTerminal(page);
      return watchSequence(page, { tutorial, retry: retry + 1 });
    }
  }
  if (tutorial) await expect(page.getByRole('button', { name: 'T Transmit', exact: true })).toBeEnabled();
  evidenceFor(page).sequenceLengths.push(expected);
  return digits;
}
export async function solve(page, { delayStageThree = false } = {}) {
  let delayed = false; const end = Date.now() + 760000; const data = evidenceFor(page);
  while (Date.now() < end) {
    if (await page.getByRole('dialog', { name: 'Run results' }).getByRole('heading', { name: 'You escaped.', exact: true }).isVisible()) return data.stages;
    // A win plays the ending (text cards under reduced motion) before the run report; skip it once seen.
    const ending = page.getByRole('main', { name: /^Ending/ });
    if (await ending.isVisible()) { data.ending = await ending.getAttribute('aria-label'); await ending.getByRole('button', { name: 'Skip cutscene →' }).click(); continue; }
    // Winning hides inspection shortly before the ending; wait for that transition.
    if (/BASEMENT DOOR MOTOR RUNNING/.test(await page.locator('.sound-caption').innerText())) { await page.waitForTimeout(100); continue; }
    await guardDanger(page); await openTerminal(page);
    const title = await page.getByRole('dialog', { name: 'Research terminal' }).locator('h2').innerText({ timeout: 1500 }).catch(() => null);
    if (title === null) continue; // power dropped between opening and reading; the next loop restores it
    if (!data.stages.includes(title)) { data.stages.push(title); console.log('stage:', title); }
    trace('solve', title, await page.getByTestId('run-deadline').innerText(), (await page.locator('.sound-caption').innerText()).split('\n')[0]);
    if (delayStageThree && !delayed && title === 'Clear the overload.') {
      delayed = true; const until = Date.now() + 90000;
      while (Date.now() < until && data.blackouts === 0) { await guardDanger(page); await page.waitForTimeout(100); }
      if (!data.blackouts) throw Error('No visible blackout occurred during the bounded stage-three observation');
      continue;
    }
    if (title === 'Reconnect the relay.') { await connectWires(page); continue; }
    if (title === 'Reconnect the conduit.') { await solveConduit(page).catch(() => {}); continue; }
    if (title === 'Mark its position.') { await locateCreature(page); continue; }
    if (title === 'Mask your heartbeat.') { await maskHeartbeat(page); continue; }
    if (title === 'Let it lose your trail.') { await holdCalm(page); continue; }
    if (await page.getByTestId('fault-hearing').count()) { await fixFaultByEar(page); continue; }
    if (title === 'Transmit a false heartbeat.' || title === 'Lead it away from the door.') {
      const transmit = page.getByRole('button', { name: 'T Transmit', exact: true });
      if (await transmit.isEnabled()) { await guardDanger(page); await transmit.click(); continue; }
      await watchSequence(page); continue;
    }
    const final = page.getByRole('button', { name: 'Last decoy · start the door motor' });
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
