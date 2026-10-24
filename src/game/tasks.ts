import { emit, type GameState } from './state';
import { issueCall, makeOrder } from './verification';

export function advanceTask(state: GameState): void {
  state.orderHistory.push(state.order);
  state.tasks.stage = Math.min(4, state.tasks.stage + 1) as 2 | 3 | 4;
  state.tasks.stageStarted = state.time;
  state.order = makeOrder(state);
  state.holding = false; state.inspected = false; state.version++;
  issueCall(state);
  emit(state, 'TASK_COMPLETE', `Operation ${state.tasks.stage - 1} completed. Current task ${state.tasks.stage === 4 ? 'complete' : state.tasks.stage}.`);
  state.notice = state.order.instructions;
  if (state.tasks.stage === 4) {
    state.status = 'won'; state.director.request = null;
    emit(state, 'SHIFT_WON', 'All three operations completed and transmission received.');
  }
}

export function cancelHold(state: GameState): void {
  state.holding = false;
  if (!state.tasks.hasCartridge) state.tasks.cartridgeHold = 0;
  if (!state.tasks.inserted) state.tasks.insertHold = 0;
  if (state.tasks.upload < 12) state.tasks.upload = state.tasks.uploadCheckpoint;
}

export function tickTasks(state: GameState, dt: number): void {
  const t = state.tasks;
  if (t.stage === 1) {
    if (t.dials.every((value, index) => value === t.targets[index]) && (state.doors.left || state.doors.right) && state.energy > 0) {
      t.sync = Math.min(20, t.sync + dt);
      if (t.sync >= 20 - 1e-8) { t.sync = 20; advanceTask(state); }
    }
  } else if (t.stage === 2) {
    if (state.holding && state.station === 'left' && state.doors.left && state.time - dt < state.safeUntil.left && !t.hasCartridge) {
      t.cartridgeHold = Math.min(3, t.cartridgeHold + dt);
      if (t.cartridgeHold >= 3 - 1e-8) {
        t.hasCartridge = true; t.cartridgeHold = 3; state.holding = false; state.version++;
        state.notice = 'Cartridge collected. Switch to RELAY and hold insert for one second.';
        emit(state, 'CARTRIDGE_COLLECTED', 'Left cartridge collected during a confirmed clear window.');
      }
    } else if (!t.hasCartridge) t.cartridgeHold = 0;
    if (state.holding && state.station === 'relay' && t.hasCartridge) {
      t.insertHold = Math.min(1, t.insertHold + dt);
      if (t.insertHold >= 1 - 1e-8) { t.inserted = true; t.insertHold = 1; advanceTask(state); }
    } else if (!t.inserted) t.insertHold = 0;
  } else if (t.stage === 3) {
    if (state.holding && state.station === 'right' && state.doors.right && state.time - dt < state.safeUntil.right
      && t.bars.every((value, index) => value === t.barTargets[index]) && state.energy > 0) {
      t.upload = Math.min(12, t.upload + dt);
      const checkpoint = Math.min(12, Math.floor((t.upload + 1e-8) / 4) * 4);
      if (checkpoint > t.uploadCheckpoint) { t.uploadCheckpoint = checkpoint; emit(state, 'UPLOAD_CHECKPOINT', `Upload saved: ${checkpoint} of 12 seconds.`); }
      if (t.upload >= 12 - 1e-8) { t.upload = 12; advanceTask(state); }
    } else if (t.upload > t.uploadCheckpoint) t.upload = t.uploadCheckpoint;
  }
}
