import authoredConfig from '../../lock-in-kit/design/config.json';
import type { GameState, NodeId, Vec3 } from './state';
/** Live difficulty tuning. The supplied build-kit archive remains unchanged. */
export const config = {
  ...authoredConfig,
  tasks: {
    ...authoredConfig.tasks,
    stage1: { ...authoredConfig.tasks.stage1, required: 8, maxActive: 2, spawnIntervalSeconds: 1.1 },
    stage2: { ...authoredConfig.tasks.stage2, inputs: 5 },
    stage3: { ...authoredConfig.tasks.stage3, required: 12, maxActive: 3, spawnIntervalSeconds: .8 },
    stage4: { ...authoredConfig.tasks.stage4, inputs: 6 },
    maxFaultNoise: .9,
    memory: { ...authoredConfig.tasks.memory, cueOnSeconds: .5, cueGapSeconds: .18, responseWindowSeconds: 20 },
  },
  sedation: [
    { fromSeconds: 0, band: 'SEDATED', searchSpeedMps: 1.1, minimumApproachSeconds: 6, warningSeconds: 2.4 },
    { fromSeconds: 65, band: 'RECOVERING', searchSpeedMps: 1.45, minimumApproachSeconds: 5, warningSeconds: 2.4 },
    { fromSeconds: 130, band: 'ALERT', searchSpeedMps: 1.8, minimumApproachSeconds: 4, warningSeconds: 2.4 },
  ],
  threat: { ...authoredConfig.threat, warningConfidenceMinimum: .5 },
  quiet: { ...authoredConfig.quiet, restoreProtectionSeconds: 6 },
  alarm: { enterDistanceM: 9.5, clearDistanceM: 11.5 },
  scares: { minimumGapSeconds: 18, maximumNonfatalPerRun: 8 },
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
