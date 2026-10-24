/** The fields used from SmartSpectra 3.4's decoded Metrics payload.
 * https://smartspectra.presagetech.com/docs/nodejs/metrics/
 * https://smartspectra.presagetech.com/docs/data-types/
 * Waveform values and landmark coordinates are never retained by this adapter. */
type Timestamp = number | { toNumber(): number } | null;
type Measurement = { value?: number | null; stable?: boolean | null; confidence?: number | null; timestamp?: Timestamp };
type Detection = { detected?: boolean | null; stable?: boolean | null; timestamp?: Timestamp };
type Hrv = Measurement & { rmssd?: number | null; meanNn?: number | null; sdnn?: number | null; baevsky?: number | null };
type Expression = { stable?: boolean | null; timestamp?: Timestamp; scores?: { type?: number | null; confidence?: number | null }[] | null };

export type NativeWellnessMetrics = {
  cardio?: { pulseRate?: Measurement[] | null; arterialPressureTrace?: Measurement[] | null; hrv?: Hrv[] | null } | null;
  breathing?: { rate?: Measurement[] | null; upperTrace?: Measurement[] | null; lowerTrace?: Measurement[] | null } | null;
  eda?: { trace?: Measurement[] | null } | null;
  face?: { blinking?: Detection[] | null; talking?: Detection[] | null; expression?: Expression[] | null } | null;
};

export type SignalSource = 'presage' | 'simulated';
export type Metric = 'pulse' | 'breathingRate' | 'chestWave' | 'abdomenWave' | 'hrv' | 'blink' | 'talking' | 'expression' | 'edaProxy' | 'arterialWave';
export const METRICS: Metric[] = ['pulse', 'breathingRate', 'chestWave', 'abdomenWave', 'hrv', 'blink', 'talking', 'expression', 'edaProxy', 'arterialWave'];
export type HrvValues = { rmssd: number; meanNn: number; sdnn: number; baevsky: number };
export type ExpressionValue = { label: string; score: number };
export type SignalValue = number | boolean | HrvValues | ExpressionValue | null;
export type SignalObservation = {
  metric: Metric;
  source: SignalSource;
  receivedAtMs: number;
  measuredAtMs: number | null;
  captureElapsedMs: number;
  validationOk: boolean;
  stable: boolean;
  confidence: number | null;
  value: SignalValue;
};

const EXPRESSION_LABELS = ['unspecified', 'angry', 'contempt', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise'];

function latest<T>(values?: T[] | null): T | undefined { return values?.at(-1); }
function number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function measuredAt(timestamp: Timestamp | undefined, receivedAtMs: number, wallMs: number): number | null {
  const micros = typeof timestamp === 'number' ? timestamp : timestamp?.toNumber() ?? null;
  return micros !== null && Number.isFinite(micros) && micros > 0 ? receivedAtMs - (wallMs - micros / 1000) : null;
}

export function adaptNativeMetrics(metrics: NativeWellnessMetrics, receivedAtMs: number, wallMs: number, captureStartedMs: number, validationOk: boolean): SignalObservation[] {
  const observations: SignalObservation[] = [];
  const add = (metric: Metric, item: Measurement | Detection | Expression | undefined, value: SignalValue, confidence: number | null = null) => {
    if (!item) return;
    observations.push({ metric, source: 'presage', receivedAtMs, measuredAtMs: measuredAt(item.timestamp, receivedAtMs, wallMs), captureElapsedMs: receivedAtMs - captureStartedMs, validationOk, stable: item.stable === true, confidence, value });
  };
  const pulse = latest(metrics.cardio?.pulseRate);
  add('pulse', pulse, number(pulse?.value), number(pulse?.confidence));
  const breathing = latest(metrics.breathing?.rate);
  add('breathingRate', breathing, number(breathing?.value), number(breathing?.confidence));
  for (const [metric, item] of [
    ['chestWave', latest(metrics.breathing?.upperTrace)],
    ['abdomenWave', latest(metrics.breathing?.lowerTrace)],
    ['edaProxy', latest(metrics.eda?.trace)],
    ['arterialWave', latest(metrics.cardio?.arterialPressureTrace)],
  ] as const) add(metric, item, number(item?.value) !== null, number(item?.confidence));
  const hrv = latest(metrics.cardio?.hrv);
  const hrvValue = hrv && [hrv.rmssd, hrv.meanNn, hrv.sdnn, hrv.baevsky].every(value => number(value) !== null)
    ? { rmssd: hrv.rmssd!, meanNn: hrv.meanNn!, sdnn: hrv.sdnn!, baevsky: hrv.baevsky! } : null;
  add('hrv', hrv, hrvValue, number(hrv?.confidence));
  for (const [metric, item] of [
    ['blink', latest(metrics.face?.blinking)],
    ['talking', latest(metrics.face?.talking)],
  ] as const) add(metric, item, typeof item?.detected === 'boolean' ? item.detected : null);
  const expression = latest(metrics.face?.expression);
  const top = expression?.scores?.filter(score => Number.isInteger(score.type) && score.type! >= 1 && score.type! < EXPRESSION_LABELS.length && number(score.confidence) !== null && score.confidence! >= 0 && score.confidence! <= 100)
    .sort((a, b) => b.confidence! - a.confidence!)[0];
  add('expression', expression, top ? { label: EXPRESSION_LABELS[top.type!], score: top.confidence! } : null);
  return observations;
}

/** Existing development mode emits a pulse-only fixture; no camera is involved. */
export function simulatedPulseObservation(receivedAtMs: number, captureStartedMs: number, pulseBpm: number | null, accepted: boolean): SignalObservation {
  return { metric: 'pulse', source: 'simulated', receivedAtMs, measuredAtMs: receivedAtMs, captureElapsedMs: receivedAtMs - captureStartedMs, validationOk: accepted, stable: accepted, confidence: null, value: pulseBpm };
}
