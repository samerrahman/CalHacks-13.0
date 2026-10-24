import { Baseline } from './baseline';
import { TrendTracker } from './trend';
import { normalizePresage } from './presageSample';
import { simulatedSample } from './simulated';
import { acceptedPulse, type SensorMode, type SensorSample, type SensorView } from './types';
import { adaptNativeMetrics, simulatedPulseObservation, type SignalObservation } from '../wellness/signals';
import type { SmartSpectraSDK } from '@smartspectra/node-sdk/renderer';
import '../integrations/contracts';

export class SensorController {
  private baseline = new Baseline();
  private trends = new TrendTracker();
  private sample: SensorSample | null = null;
  private sdk: SmartSpectraSDK | null = null;
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(view: SensorView) => void>();
  private wellnessListeners = new Set<(observation: SignalObservation) => void>();
  private generation = 0;
  private disposed = false;
  private retiring: Promise<void> = Promise.resolve();
  private startedAt = 0;
  private mode: SensorMode = 'manual';
  private status: SensorView['status'] = 'manual';
  private hint = 'MANUAL · no camera or pulse data';
  private elevated = false;
  subscribe(listener: (view: SensorView) => void): () => void { this.listeners.add(listener); listener(this.view()); return () => this.listeners.delete(listener); }
  subscribeWellness(listener: (observation: SignalObservation) => void): () => void { this.wellnessListeners.add(listener); return () => this.wellnessListeners.delete(listener); }
  view(): SensorView {
    const now = performance.now();
    const pulse = acceptedPulse(this.sample, now, this.mode === 'simulated');
    const usable = this.status === 'calibrating' || this.status === 'ready';
    return { source: this.mode, status: this.status, trend: usable ? this.trends.classify(this.baseline.value, now, this.mode === 'simulated') : 'UNKNOWN', quality: usable && pulse !== null ? 'accepted' : this.sample?.quality === 'rejected' ? 'rejected' : 'unknown', hint: this.hint, baselineBpm: this.baseline.value, pulseBpm: usable ? pulse : null, ageMs: this.sample ? Math.max(0, now - this.sample.receivedAtMs) : null, acceptedSeconds: Math.min(30, this.baseline.acceptedMs / 1000), canContinueManual: now - this.startedAt >= 60_000 || this.status === 'unavailable' || this.mode !== 'presage' };
  }
  private publish(): void { const view = this.view(); this.listeners.forEach(l => l(view)); }
  private accept(sample: SensorSample): void {
    this.sample = sample;
    if (sample.source === 'simulated') {
      const observation = simulatedPulseObservation(sample.receivedAtMs, this.startedAt, sample.pulseBpm, sample.quality === 'accepted');
      this.wellnessListeners.forEach(listener => listener(observation));
    }
    this.baseline.add(sample, performance.now(), this.mode === 'simulated');
    this.trends.add(sample);
    this.status = this.baseline.value === null ? 'calibrating' : 'ready';
    this.hint = sample.quality === 'accepted' ? this.mode === 'simulated' ? 'SIMULATED · development fixture, camera off' : this.baseline.value === null ? 'Stable capture · collecting 30 usable seconds' : 'LIVE · accepted sustained pulse trend' : sample.qualityReasons.join(' · ');
    this.publish();
  }
  async start(mode: SensorMode, preserveBaseline = false): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    await this.stopResources();
    if (generation !== this.generation || this.disposed) return;
    this.mode = mode;
    if (!preserveBaseline) this.baseline.reset();
    this.trends.reset(); this.sample = null; this.startedAt = performance.now();
    if (mode === 'manual') { this.status = 'manual'; this.hint = 'MANUAL · no camera or pulse data'; this.publish(); return; }
    this.status = 'starting'; this.hint = mode === 'presage' ? 'Checking native camera integration' : 'SIMULATED · development fixture'; this.publish();
    if (mode === 'simulated') {
      this.accept(simulatedSample(performance.now(), this.elevated));
      this.timer = setInterval(() => this.accept(simulatedSample(performance.now(), this.elevated)), 1000);
      return;
    }
    try {
      const available = await window.nightRelay?.status();
      if (!available?.presage) throw new Error(available?.reasons[0] ?? 'Live Presage requires the Electron app and a configured key');
      const [{ SmartSpectraSDK: SDK, MetricType }, { decodeMetrics }] = await Promise.all([import('@smartspectra/node-sdk/renderer'), import('@smartspectra/node-sdk/messages')]);
      if (generation !== this.generation) return;
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 }, frameRate: { ideal: 30, max: 30 }, facingMode: 'user' }, audio: false });
      if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      stream.getTracks().forEach(track => track.addEventListener('ended', () => { if (generation === this.generation) void this.unavailable('Camera stopped or permission revoked'); }, { once: true }));
      const sdk = new SDK({ requestedMetrics: [MetricType.PULSE_RATE], enableTelemetry: false, sendTimeoutMs: 8000 });
      this.sdk = sdk;
      let validation: { code: number | null; hint: string } = { code: null, hint: 'Waiting for capture validation' };
      sdk.on('validationStatus', (code, _timestamp, hint) => { validation = { code, hint }; if (code !== 0) { this.hint = hint; if (this.sample) { this.sample = { ...this.sample, quality: 'rejected', qualityReasons: [hint] }; this.trends.discard(); this.baseline.discardContinuity(); } this.publish(); } });
      sdk.on('metrics', buffer => {
        if (generation !== this.generation) return;
        const receiveMs = performance.now();
        const wallMs = Date.now();
        try {
          const metrics = decodeMetrics(buffer);
          this.accept(normalizePresage(metrics, receiveMs, wallMs, this.startedAt, validation));
          for (const observation of adaptNativeMetrics(metrics, receiveMs, wallMs, this.startedAt, validation.code === 0)) {
            this.wellnessListeners.forEach(listener => listener(observation));
          }
        }
        catch { this.hint = 'Pulse payload could not be decoded'; this.sample = null; this.publish(); }
      });
      sdk.on('error', (code, message) => { if (generation === this.generation) void this.unavailable(`Sensor ${code}: ${message}`); });
      sdk.useMediaStream(stream);
      await sdk.start();
      if (generation !== this.generation) return;
      this.status = 'calibrating'; this.hint = 'Face the camera in steady light · warming up for 12 seconds';
      this.timer = setInterval(() => {
        if (this.sample && performance.now() - this.sample.receivedAtMs > 5000) this.hint = 'Stale sensor data · neutral gameplay';
        if (this.baseline.value === null && performance.now() - this.startedAt >= 60_000) this.hint = 'Calibration not ready · continue in manual mode';
        this.publish();
      }, 1000);
      this.publish();
    } catch (error) { if (generation === this.generation) await this.unavailable(error instanceof Error ? error.message : 'Camera unavailable'); }
  }
  private async unavailable(hint: string): Promise<void> {
    const generation = ++this.generation;
    await this.stopResources();
    if (generation !== this.generation || this.disposed) return;
    this.status = 'unavailable'; this.hint = hint; this.publish();
  }
  setSimulatedElevated(value: boolean): void { this.elevated = value; }
  private async stopResources(): Promise<void> {
    if (this.timer) clearInterval(this.timer); this.timer = null;
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null;
    const sdk = this.sdk; this.sdk = null;
    this.sample = null; this.trends.discard(); this.baseline.discardContinuity();
    const previous = this.retiring;
    this.retiring = (async () => {
      await previous;
      if (sdk) { try { await sdk.stop(); } catch { /* already stopped */ } finally { try { sdk.destroy(); } catch { /* bridge already torn down */ } } }
    })();
    await this.retiring;
  }
  async stop(): Promise<void> {
    const generation = ++this.generation;
    await this.stopResources();
    if (generation !== this.generation || this.disposed) return;
    this.status = 'manual'; this.publish();
  }
  async pause(): Promise<void> {
    const generation = ++this.generation;
    await this.stopResources();
    if (generation !== this.generation || this.disposed) return;
    this.status = 'paused'; this.hint = 'Capture paused · stale data discarded'; this.publish();
  }
  async resume(): Promise<void> { await this.start(this.mode, true); }
  async dispose(): Promise<void> { this.disposed = true; this.generation++; this.listeners.clear(); this.wellnessListeners.clear(); await this.stopResources(); }
}
