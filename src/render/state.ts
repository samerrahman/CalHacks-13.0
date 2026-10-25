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
  /** Live part of the stage and its progress, so the in-room screen matches the HUD task. */
  step?: string;
  /** Machine the rack key is playing (faults are otherwise never marked on screen). */
  listening?: number | null;
  progress?: [number, number] | null;
  pulseFlash?: number;
  breath?: number;
  breathMatched?: boolean;
  creature: { position: WorldPosition; phase: string; distance: number; sensorDistance?: number | null; sensorSampleAt?: number; sensorBearing?: number };
  cameraFeed?: CameraFeed;
  status?: 'playing' | 'won' | 'lost';
  warningRemaining?: number | null;
  doorImpactAt?: number | null;
  alarm?: { active: boolean; urgency: number };
  scare?: ScareEvent | null;
  softScares?: boolean;
  inspection?: boolean;
  /** Basement locks released (completed research stages, 0–4). */
  locks?: number;
  /** The last decoy is out and the basement door motor is spinning up. */
  doorMotor?: boolean;
  /** Wall status unit: deadline seconds (null in practice), isolation cells and 0–100 exposure. */
  survival?: { secondsLeft: number | null; cells: number; maxCells: number; exposure: number };
  /** Hand-held isolation remote: raised (open), cells, whether Q works now, seconds of cooldown / auto restore, restore readiness and hold 0–1. */
  remote?: { open: boolean; cells: number; maxCells: number; quietReady: boolean; cooldown: number; autoRestore: number; restoreReady: boolean; restoreHold: number };
}
