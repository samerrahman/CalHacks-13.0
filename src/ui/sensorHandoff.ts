import type { SensorController } from '../sensing/controller';
import type { SensorMode, SensorView } from '../sensing/types';

/** Reuse the consenting capture when moving from calibration into play.
 * Call with the current controller view and latest selected mode: a manual
 * selection must win even if native shutdown has not finished yet. */
export function resumeSensorCapture(
  controller: Pick<SensorController, 'start'>,
  current: SensorView,
  mode: SensorMode,
  preserveBaseline = true,
): void {
  const active = current.status === 'starting' || current.status === 'calibrating' || current.status === 'ready';
  if (mode !== 'manual' && current.source === mode && active) return;
  void controller.start(mode, preserveBaseline);
}
