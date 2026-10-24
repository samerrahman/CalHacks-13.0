import type { CameraFeed, WorldPosition } from './cctv';
import type { ScareEvent } from './presentation';
export interface RenderState {
  time: number;
  paused?: boolean;
  power: 'on' | 'quiet' | 'blackout';
  stage: number;
  faults: number[];
  faultsResolved?: number;
  faultsRequired?: number;
  sequenceCue?: number | null;
  sequenceLength?: number;
  entered?: number[];
  armed?: boolean;
  creature: { position: WorldPosition; phase: string; distance: number; sensorDistance?: number | null; sensorSampleAt?: number };
  cameraFeed?: CameraFeed;
  status?: 'playing' | 'won' | 'lost';
  warningRemaining?: number | null;
  doorImpactAt?: number | null;
  alarm?: { active: boolean; urgency: number };
  scare?: ScareEvent | null;
  softScares?: boolean;
  inspection?: boolean;
}
