import type { SensorView } from './types';
import { sanitizeSensorError } from './sensorError';

export type SignalCheckState = 'needs-desktop' | 'needs-camera' | 'starting' | 'adjust' | 'warming' | 'ok' | 'failed';
export type AdjustIssue = 'no-face' | 'multiple-faces' | 'framing' | 'too-dark' | 'too-bright' | 'chest' | 'camera-tuning' | 'low-frame-rate' | 'motion' | 'unknown';
export type SignalCheck = {
  state: SignalCheckState; title: string; detail: string;
  issue?: AdjustIssue; validationCode?: number; secondsLeft?: number;
  /** Usable baseline seconds so far, 0..30. */
  baselineSeconds: number;
  /** Only after 30 usable seconds; the check itself never claims calibration. */
  calibrated: boolean;
  simulated: boolean;
};
/** SDK 3.4 ValidationCode values (js/constants.js). */
const ISSUES: Record<number, [AdjustIssue, string, string]> = {
  1: ['no-face', 'No face found', 'Face the camera so your whole face is in the preview.'],
  2: ['multiple-faces', 'More than one face', 'Only one person should be in view.'],
  3: ['framing', 'Adjust framing', 'Center your face in the preview.'],
  4: ['framing', 'Adjust framing', 'Move so your face fits the guide.'],
  5: ['too-dark', 'Too dark', 'Add steady light in front of you.'],
  6: ['too-bright', 'Too bright', 'Reduce glare or strong light on your face.'],
  7: ['chest', 'Chest not visible', 'Sit back so your shoulders and upper chest are visible.'],
  10: ['camera-tuning', 'Camera adjusting', 'The camera is still adjusting exposure. Hold still.'],
  11: ['low-frame-rate', 'Frame rate too low', 'Close other camera apps or add light.'],
  12: ['motion', 'Too much motion', 'Hold still and keep the camera steady.'],
  13: ['framing', 'Too close', 'Sit back a little.'],
  14: ['framing', 'Too far', 'Move a little closer.'],
  15: ['framing', 'Face too high', 'Lower the camera or move down in the frame.'],
  16: ['framing', 'Face too low', 'Raise the camera or sit up.'],
  17: ['framing', 'Face the camera', 'Look straight at the camera.'],
};

/** Start-of-game video check. Pure: derived only from the controller's view
 * and whether the native desktop bridge exists. 'ok' means native processing
 * is running, frames are forwarded, validation is 0 and an accepted pulse
 * arrived after the 12 s warm-up. The 30 s baseline continues afterwards. */
export function signalCheck(view: SensorView, desktop = true): SignalCheck {
  const baselineSeconds = Math.floor(Math.max(0, Math.min(30, view.acceptedSeconds)));
  const base = { baselineSeconds, calibrated: view.baselineBpm !== null && view.acceptedSeconds >= 30, simulated: view.source === 'simulated' };
  const d = view.diagnostics;
  if (view.source === 'simulated') return { state: 'ok', title: 'SIMULATED signals', detail: 'Development fixture · camera off · not a live reading.', ...base };
  if (!desktop) return { state: 'needs-desktop', title: 'Desktop app required', detail: 'Camera signal sensing is available in the HUSH desktop app. You can play without sensing.', ...base };
  if (view.source === 'manual' || view.status === 'manual' || view.status === 'paused') return { state: 'needs-camera', title: view.status === 'paused' ? 'Camera paused' : 'Camera off', detail: 'Turn on your camera for a quick signal check. No camera recording is saved.', ...base };
  if (view.status === 'unavailable' || d?.processingStatus === 'error') return { state: 'failed', title: 'Camera check failed', detail: sanitizeSensorError(d?.blocker || view.hint || 'Camera unavailable'), ...base };
  if (!d || d.captureState !== 'live') return { state: 'starting', title: 'Starting camera', detail: 'Waiting for camera access.', ...base };
  if (d.processingStatus !== 'running') return { state: 'starting', title: 'Starting analysis', detail: `Native processing: ${d.processingStatus}.`, ...base };
  if (d.framesSentThrough === 0) return { state: 'starting', title: 'Starting analysis', detail: 'Waiting for the first camera frame.', ...base };
  if (d.validationCode === null) return { state: 'starting', title: 'Checking framing', detail: 'Waiting for capture validation.', ...base };
  if (d.validationCode !== 0) {
    const [issue, title, detail] = ISSUES[d.validationCode] ?? ['unknown', 'Adjust capture', d.validationHint || `Capture validation ${d.validationCode}.`];
    return { state: 'adjust', issue, validationCode: d.validationCode, title, detail, ...base };
  }
  if (d.warmupRemainingSeconds > 0) return { state: 'warming', title: 'Warming up', detail: 'Pulse needs a 12-second window. Hold still.', secondsLeft: Math.ceil(d.warmupRemainingSeconds), ...base };
  if (view.quality === 'accepted' && view.pulseBpm !== null) return { state: 'ok', title: 'Signal OK', detail: base.calibrated ? 'Baseline calibrated.' : `Pulse accepted · calibrating baseline (${baselineSeconds}/30 usable seconds). Hold still to finish calibration.`, ...base };
  return { state: 'warming', title: 'Waiting for a steady pulse', detail: d.pulse.state === 'rejected' ? `Hold still in steady light. ${d.pulse.reasons[0] ?? ''}`.trim() : 'Waiting for the first accepted pulse estimate.', secondsLeft: 0, ...base };
}
