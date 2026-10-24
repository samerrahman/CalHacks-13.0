import authoredConfig from '../../lock-in-kit/design/config.json';
import type { GameState, NodeId, Vec3 } from './state';
/** Live difficulty tuning. The supplied build-kit archive remains unchanged. */
export const config = {
  ...authoredConfig,
  tasks: {
    ...authoredConfig.tasks,
    stage1: { ...authoredConfig.tasks.stage1, required: 24, maxActive: 2, spawnIntervalSeconds: 1.4, wires: 12 },
    stage2: { ...authoredConfig.tasks.stage2, firstInputs: 3, inputs: 7 },
    stage3: { ...authoredConfig.tasks.stage3, required: 36, maxActive: 3, spawnIntervalSeconds: 1, wires: 18 },
    stage4: { ...authoredConfig.tasks.stage4, firstInputs: 4, inputs: 8 },
    wirePanelSize: 6,
    /** Floor of machinery noise while research equipment is powered and a task is live. */
    equipmentNoise: .35,
    /** Each correct fault, cable or memory input is a short audible transient. */
    workNoise: { strength: .3, decaySeconds: 4 },
    routing: { rounds: 4, maximumRating: 8 },
    pulse: { minimumBpm: 54, maximumBpm: 90, beats: 10, tolerance: .15, elevatedBeats: 12, elevatedTolerance: .12 },
    locate: { marks: 5, spacingSeconds: 6 },
    calm: { seconds: 16, breathSeconds: 4, graceSeconds: .45, steadyMultiplier: 1.5, elevatedMultiplier: .6, drainPerSecond: .5 },
    maxFaultNoise: .9,
    memory: { ...authoredConfig.tasks.memory, cueOnSeconds: .36, cueGapSeconds: .14, responseWindowSeconds: 16 },
  },
  sedation: [
    { fromSeconds: 0, band: 'SEDATED', searchSpeedMps: 1.1, minimumApproachSeconds: 6, warningSeconds: 2.4 },
    { fromSeconds: 150, band: 'RECOVERING', searchSpeedMps: 1.45, minimumApproachSeconds: 5, warningSeconds: 2.4 },
    { fromSeconds: 300, band: 'ALERT', searchSpeedMps: 1.8, minimumApproachSeconds: 4, warningSeconds: 2.4 },
  ],
  threat: { ...authoredConfig.threat, warningConfidenceMinimum: .5 },
  quiet: { ...authoredConfig.quiet, restoreProtectionSeconds: 6 },
  alarm: { enterDistanceM: 9.5, clearDistanceM: 11.5 },
  scares: { minimumGapSeconds: 18, maximumNonfatalPerRun: 8 },
  line: { length: 24, start: 18, stepSeconds: 2.5, maximumStep: 3, graceSeconds: 25, deadlineSeconds: 720, nearPosition: 7, clearPosition: 10, commitPosition: 1, minimumWarningSeconds: 2.5, committedSeconds: 2.4, sensorSeconds: 4, soundEvidenceSeconds: 30 },
  lineWeights: [.07, .14, .23, .22, .19, .10, .05],
  /** Low exposure drifts it away; high exposure (loud work) rushes it toward the wall. */
  lineBias: { base: .32, dangerScale: 1.36, lostTrailSeconds: 8, lostTrailBias: .6, momentum: .06, providerMaximum: .15, providerDurationSeconds: 8, quietDangerScale: .2, lureDangerScale: .1, minimum: -.85, maximum: 1, finalLure: 1 },
  /** Pressure is work noise: correct inputs and active faults raise it, quiet cools it. */
  danger: { base: 10, timeMaximum: 25, pressureMaximum: 55, pressureDecayPerSecond: .6, quietCoolingMultiplier: 6, workPressure: 1.8, machineryPressurePerSecond: .8, mistakePressure: 6, stageRelief: 8, physiologyMaximum: 5, shutdownAdaptation: 2 },
  shutdown: { charges: 5, stageRefill: 2, durationSeconds: 12, cooldownSeconds: 10, retreatBias: 1, listeningSeconds: 4, manualRestoreAfterSeconds: 8 },
  /** Seeded charges: one per period, at a seeded offset. Isolation and lures still override. */
  hunt: { firstSeconds: 70, periodSeconds: 100, durationSeconds: 10, bias: -.85 },
  lineLure: { EMITTER_A: 20, EMITTER_B: 22, CONTAINMENT: 24, bias: .85, durationSeconds: 12 },
};
export const FIXED_DT = 1 / config.simulation.fixedStepHz;
export const NODES = config.graph.nodes as Record<NodeId, Vec3>;
export const EDGES = config.graph.edges as [NodeId, NodeId][];
export function currentSedation(state: Pick<GameState, 'time' | 'mode'>) {
  const time = state.mode === 'tutorial' ? 0 : state.time;
  return [...config.sedation].reverse().find(band => time >= band.fromSeconds)!;
}
export const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));
