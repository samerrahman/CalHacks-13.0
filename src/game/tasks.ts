import { config } from './config';
import { applyLure, contextualTaunt } from './creature';
import { emit, random, type GameState, type MemoryState, type Stage } from './state';

export function emptyMemory(): MemoryState {
  return { sequence: [], input: [], playbackIndex: 0, cue: null, playbackElapsed: 0, playing: false, tempo: 1, responseElapsed: 0, armed: false, needsReplay: false };
}
export function memoryLength(state: GameState): number { return state.mode === 'tutorial' ? 4 : state.tasks.stage === 4 ? config.tasks.stage4.inputs : config.tasks.stage2.inputs; }
function sequenceFor(state: GameState): number[] {
  return Array.from({ length: memoryLength(state) }, () => 1 + Math.floor(random(state) * 4));
}
function tempoFor(state: GameState): number {
  return !state.fixedMemoryTempo && state.sensor.source !== 'manual' && state.sensor.quality === 'accepted' && state.sensor.trend === 'ELEVATED' ? config.tasks.memory.maximumTempoMultiplier : 1;
}
export function replayMemory(state: GameState, keepInput = false): void {
  if ((state.tasks.stage !== 2 && state.tasks.stage !== 4) || state.equipment !== 'on') return;
  const memory = state.tasks.memory;
  memory.playing = true; memory.playbackElapsed = 0; memory.playbackIndex = 0; memory.cue = memory.sequence[0];
  memory.tempo = tempoFor(state); memory.responseElapsed = 0; memory.armed = false; memory.needsReplay = false;
  if (!keepInput) memory.input = [];
  state.notice = `Watch ${memory.sequence.length} cues. Enter the sequence after playback. R replays for free.`;
  emit(state, 'MEMORY_REPLAY');
}
export function startStage(state: GameState, stage: Stage): void {
  state.tasks.stage = stage; state.tasks.stageStarted = state.time; state.version++;
  if (stage === 1 || stage === 3) {
    const settings = stage === 1 ? config.tasks.stage1 : config.tasks.stage3;
    state.tasks.faults = { active: [Math.floor(random(state) * 4)], completed: 0, required: settings.required, spawned: 1, spawnElapsed: 0, maximumActive: settings.maxActive };
    state.tasks.memory = emptyMemory();
    state.notice = stage === 1 ? 'Silence eight faults. Use Q before the approach reaches the wall.' : 'Twelve overload faults. Up to three boxes can be active.';
  } else if (stage === 2 || stage === 4) {
    state.tasks.faults.active = [];
    state.tasks.memory = { ...emptyMemory(), sequence: sequenceFor(state) };
    replayMemory(state);
  } else if (stage === 5) {
    state.tasks.memory = emptyMemory(); state.tasks.faults.active = [];
    state.notice = 'All four research stages complete. Press T to broadcast the final containment signal.';
  }
}
function completeStage(state: GameState): void {
  const stage = state.tasks.stage;
  if (state.tasks.completedStages.includes(stage)) return;
  state.tasks.completedStages.push(stage);
  state.transients.push({ at: state.time, strength: config.tasks.completionStrength, duration: config.tasks.completionDecaySeconds });
  emit(state, 'TASK_COMPLETE', String(stage));
}
function mistake(state: GameState, kind: 'FAULT' | 'MEMORY'): void {
  // Reducer rate limit covers rapid repeated buttons, not only keyboard repeat.
  const last = [...state.events].reverse().find(event => event.type === 'WRONG_INPUT');
  if (!last || state.time - last.time >= .25) {
    state.transients.push({ at: state.time, strength: config.tasks.mistakeStrength, duration: config.tasks.mistakeDecaySeconds });
    emit(state, 'WRONG_INPUT', kind);
    contextualTaunt(state, 'AFTER_MISTAKE');
  }
  state.notice = kind === 'FAULT' ? 'That box was quiet. Press a box marked FAULT.' : `Sequence mismatch. Repeat all ${state.tasks.memory.sequence.length} inputs. R replays for free.`;
}
export function taskInput(state: GameState, value: number): void {
  if (state.equipment !== 'on' || state.station !== 'terminal' || !Number.isInteger(value) || value < 1 || value > 4) return;
  const stage = state.tasks.stage;
  if (stage === 1 || stage === 3) {
    const faults = state.tasks.faults, index = value - 1;
    if (faults.completed >= faults.required) return;
    if (!faults.active.includes(index)) { mistake(state, 'FAULT'); return; }
    faults.active = faults.active.filter(fault => fault !== index); faults.completed++;
    emit(state, 'FAULT_CLEARED', String(stage));
    state.notice = `${faults.completed} / ${faults.required} faults resolved.`;
    if (faults.completed >= faults.required) { completeStage(state); startStage(state, stage === 1 ? 2 : 4); }
    return;
  }
  if (stage !== 2 && stage !== 4) return;
  const memory = state.tasks.memory;
  if (memory.playing || memory.armed || memory.needsReplay) return;
  if (value !== memory.sequence[memory.input.length]) { memory.input = []; memory.responseElapsed = 0; mistake(state, 'MEMORY'); return; }
  memory.input.push(value);
  if (memory.input.length === memory.sequence.length) {
    memory.armed = true; state.notice = 'Sequence matched. Press T to transmit the calibrated signal.';
    emit(state, 'MEMORY_ARMED'); state.version++;
  }
}
export function transmit(state: GameState): void {
  if (state.equipment !== 'on' || state.station !== 'terminal' || state.creature.warning) return;
  const stage = state.tasks.stage;
  if ((stage === 2 || stage === 4) && state.tasks.memory.armed) {
    completeStage(state); applyLure(state, stage === 2 ? 'EMITTER_A' : 'EMITTER_B');
    startStage(state, stage === 2 ? 3 : 5);
  } else if (stage === 5 && !state.tasks.finalTransmitted && state.tasks.completedStages.length === 4) {
    state.tasks.finalTransmitted = true;
    applyLure(state, 'CONTAINMENT'); emit(state, 'FINAL_BROADCAST'); state.version++;
  }
}
export function tickTasks(state: GameState, dt: number): void {
  if (state.equipment !== 'on') return;
  const stage = state.tasks.stage;
  if (stage === 1 || stage === 3) {
    const faults = state.tasks.faults;
    const interval = stage === 1 ? config.tasks.stage1.spawnIntervalSeconds : config.tasks.stage3.spawnIntervalSeconds;
    faults.spawnElapsed += dt;
    if (faults.spawnElapsed >= interval - 1e-8 && faults.active.length < faults.maximumActive && faults.spawned < faults.required) {
      const available = [0, 1, 2, 3].filter(index => !faults.active.includes(index));
      faults.active.push(available[Math.floor(random(state) * available.length)]); faults.spawned++; faults.spawnElapsed = 0;
      emit(state, 'FAULT_STARTED');
    }
  } else if (stage === 2 || stage === 4) {
    const memory = state.tasks.memory;
    if (memory.playing) {
      memory.playbackElapsed += dt;
      const interval = (config.tasks.memory.cueOnSeconds + config.tasks.memory.cueGapSeconds) / memory.tempo;
      const index = Math.floor((memory.playbackElapsed + 1e-9) / interval);
      memory.playbackIndex = Math.min(index, memory.sequence.length);
      if (index >= memory.sequence.length) {
        memory.playing = false; memory.cue = null; memory.responseElapsed = 0;
        state.notice = `Enter all ${memory.sequence.length} cues in order. R replays for free.`;
        emit(state, 'MEMORY_READY');
      } else {
        const offset = memory.playbackElapsed - index * interval;
        memory.cue = offset < config.tasks.memory.cueOnSeconds / memory.tempo - 1e-9 ? memory.sequence[index] : null;
      }
    } else if (!memory.armed && !memory.needsReplay) {
      memory.responseElapsed += dt;
      if (memory.responseElapsed >= config.tasks.memory.responseWindowSeconds) {
        memory.needsReplay = true; memory.input = []; state.notice = 'Entry window elapsed. R replays for free; no noise penalty.';
        emit(state, 'MEMORY_EXPIRED');
      }
    }
  }
}
