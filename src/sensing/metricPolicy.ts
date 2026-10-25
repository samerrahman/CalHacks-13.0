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
