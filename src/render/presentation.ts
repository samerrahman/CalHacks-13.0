export interface ScareEvent { id: string | number; at: number; kind: 'impact' | 'monitor' | 'breach' }
/** Low-frequency illumination only; no flashes and no independent threat timer. */
export function alarmIntensity(time: number, alarm?: { active: boolean; urgency: number }, reducedMotion = false): number {
  if (!alarm?.active) return 0;
  const urgency = Number.isFinite(alarm.urgency) ? Math.max(0, Math.min(1, alarm.urgency)) : 0;
  const pulse = reducedMotion ? .72 : .67 + Math.sin(Math.max(0, time) * Math.PI * .8) * .22;
  return (.45 + urgency * .55) * pulse;
}
export function scareStrength(time: number, scare?: ScareEvent | null, reducedMotion = false, softScares = false): number {
  if (!scare || !Number.isFinite(time) || !Number.isFinite(scare.at)) return 0;
  const age = time - scare.at, duration = scare.kind === 'monitor' ? .8 : .52;
  if (age < 0 || age >= duration) return 0;
  return (1 - age / duration) * (reducedMotion ? .15 : softScares ? .34 : .72);
}
