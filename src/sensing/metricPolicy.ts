/** SDK 3.4 generated MeasurementWithConfidence field documentation defines
 * stable pulse at confidence >=40 and stable breathing at >=45. Retain the
 * provider's stable verdict as a separate requirement; confidence alone does
 * not establish an acceptable reading. These are nonmedical game inputs.
 * Primary sources: installed js/messages/generated.d.ts (Cardio/Breathing),
 * https://vandv.presagetech.com/arterial_pressure_model_card.html and
 * https://vandv.presagetech.com/breathing_model_card.html . */
export const METRIC_POLICY = {
  pulse: { confidence: 40, warmupSeconds: 12, range: [40, 110] as const },
  breathing: { confidence: 45, warmupSeconds: 30, range: [5, 40] as const },
} as const;
export type MetricKind = keyof typeof METRIC_POLICY;

/** The provider explicitly scopes CHEST_NOT_VISIBLE (7) to breathing/chest
 * metrics. All face, lighting, motion, frame-rate, unknown and missing codes
 * still block both. https://smartspectra.presagetech.com/docs/measurement-quality/ */
export function validationBlocksMetric(code: number | null, metric: MetricKind): boolean {
  return code !== 0 && !(metric === 'pulse' && code === 7);
}

/** Every standard SmartSpectra 3.4 metric HUSH reads. Strict variants (18, 19)
 * cannot share a session with these and are never requested. Electron main
 * owns the effective request; the renderer list mirrors it. Unauthorized
 * metrics are silently omitted by the SDK, so each signal reports a
 * "not provided" state instead of an error. */
export const REQUESTED_METRICS = ['PULSE_RATE', 'BREATHING_RATE', 'CHEST_BREATHING', 'ABDOMEN_BREATHING', 'HRV', 'BLINKING', 'TALKING', 'EXPRESSIONS', 'EDA_TRACE', 'ARTERIAL_PRESSURE_TRACE'] as const;
/** PRESAGE_METRICS=core in Electron main falls back to the original pair. */
export const CORE_METRICS = ['PULSE_RATE', 'BREATHING_RATE'] as const;
export type RequestedMetric = typeof REQUESTED_METRICS[number];

/** Game tuning for the extra signals, measured from the first forwarded frame.
 * Confidence floors come from the installed generated.d.ts field docs (arterial
 * shares pulse's 40, HRV stable is >=50); traces inherit the breathing verdict
 * and are blocked by chest validation code 7. EDA output needs >35 s. A signal
 * with no entry by warm-up + grace is reported as not provided. */
export const SIGNAL_POLICY = {
  chest: { warmupSeconds: 30, chest: true },
  abdomen: { warmupSeconds: 30, chest: true },
  arterial: { warmupSeconds: 12, confidence: 40, chest: false },
  hrv: { warmupSeconds: 30, confidence: 50, chest: false, freshMs: 10_000 },
  blinking: { warmupSeconds: 3, observeSeconds: 20, chest: false },
  talking: { warmupSeconds: 3, chest: false },
  expressions: { warmupSeconds: 5, chest: false },
  eda: { warmupSeconds: 35, baselineSeconds: 60, chest: false },
} as const;
export const NOT_PROVIDED_GRACE_MS = 20_000;
