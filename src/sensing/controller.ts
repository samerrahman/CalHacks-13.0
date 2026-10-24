import { Baseline } from './baseline';
import { TrendTracker } from './trend';
import { normalizePresage } from './presageSample';
import { simulatedSample } from './simulated';
import { acceptedPulse, type SensorMode, type SensorSample, type SensorView } from './types';
import type { SmartSpectraSDK } from '@smartspectra/node-sdk/renderer';
import '../integrations/contracts';

export class SensorController {
  private baseline = new Baseline();
  private trends = new TrendTracker();
  private sample: SensorSample | null = null;
  private sdk: SmartSpectraSDK | null = null;
  private stream: MediaStream | null = null;
  private previewListeners = new Set<(stream: MediaStream | null) => void>();
  private cameraDeviceId = '';
  /** Local-only view of the same consenting capture, never another camera stream. */
  subscribePreview(listener:(stream:MediaStream|null)=>void):()=>void { this.previewListeners.add(listener);listener(this.stream);return()=>{this.previewListeners.delete(listener)}; }
  setCameraDevice(deviceId:string):void { this.cameraDeviceId=deviceId; }
  private publishPreview():void { this.previewListeners.forEach(listener=>listener(this.stream)); }
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(view: SensorView) => void>();
  private sampleListeners = new Set<(sample: SensorSample, captureSegment: number) => void>();
  private captureSegment = 0;
  private generation = 0;
  private disposed = false;
  private retiring: Promise<void> = Promise.resolve();
  private startedAt = 0;
  private mode: SensorMode = 'manual';
  private status: SensorView['status'] = 'manual';
  private hint = 'MANUAL · no camera or pulse data';
  private elevated = false;
  subscribe(listener: (view: SensorView) => void): () => void { this.listeners.add(listener); listener(this.view()); return () => this.listeners.delete(listener); }
  /** Local-only recorder hook. Consumers must independently require report consent. */
  subscribeSamples(listener: (sample: SensorSample, captureSegment: number) => void): () => void { this.sampleListeners.add(listener); return () => this.sampleListeners.delete(listener); }
  view(): SensorView {
    const now = performance.now();
    const pulse = acceptedPulse(this.sample, now, this.mode === 'simulated');
    const usable = this.status === 'calibrating' || this.status === 'ready';
    return { source: this.mode, status: this.status, trend: usable && pulse !== null ? this.trends.classify(this.baseline.value, now, this.mode === 'simulated') : 'UNKNOWN', quality: usable && pulse !== null ? 'accepted' : this.sample?.quality === 'rejected' ? 'rejected' : 'unknown', hint: this.hint, baselineBpm: this.baseline.value, pulseBpm: usable ? pulse : null, ageMs: this.sample ? Math.max(0, now - this.sample.receivedMonotonicMs) : null, acceptedSeconds: Math.min(30, this.baseline.acceptedMs / 1000), canContinueManual: now - this.startedAt >= 60_000 || this.status === 'unavailable' || this.mode !== 'presage', sampleAtMs: usable && pulse !== null ? this.sample!.measuredMonotonicMs : null, captureSegment: this.captureSegment };
  }
  private publish(): void { const view = this.view(); this.listeners.forEach(l => l(view)); }
  private accept(sample: SensorSample): void {
    if (this.disposed) return;
    this.sample = sample;
    this.baseline.add(sample, performance.now(), this.mode === 'simulated');
    this.trends.add(sample);
    this.status = this.baseline.value === null ? 'calibrating' : 'ready';
    this.hint = sample.quality === 'accepted' ? this.mode === 'simulated' ? 'SIMULATED · development fixture, camera off' : this.baseline.value === null ? 'Stable capture · collecting 30 usable seconds' : 'LIVE · accepted sustained pulse trend' : sample.qualityReasons.join(' · ');
    this.sampleListeners.forEach(listener => listener({ ...sample, qualityReasons: [...sample.qualityReasons] }, this.captureSegment));
    this.publish();
  }
  async start(mode: SensorMode, preserveBaseline = false): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    // Retire synchronously and publish neutral input before waiting on native shutdown.
    // A slow SDK stop must never leave consumers holding a previous accepted trend.
    await this.retireCapture(mode === 'manual' ? 'manual' : 'starting', mode === 'manual' ? 'MANUAL · no camera or pulse data' : 'Capture restarting · neutral until fresh accepted data');
    if (generation !== this.generation || this.disposed) return;
    this.captureSegment++;
    this.mode = mode;
    if (!preserveBaseline) this.baseline.reset();
    this.trends.reset(); this.sample = null; this.startedAt = performance.now();
    if (mode === 'manual') { this.status = 'manual'; this.hint = 'MANUAL · no camera or pulse data'; this.publish(); return; }
    this.status = 'starting'; this.hint = mode === 'presage' ? 'Checking native camera integration' : 'SIMULATED · development fixture'; this.publish();
    if (mode === 'simulated') {
      this.accept(simulatedSample(performance.now(), this.elevated));
      this.timer = setInterval(() => { if (generation === this.generation) this.accept(simulatedSample(performance.now(), this.elevated)); }, 1000);
      return;
    }
    try {
      const available = await window.lockIn?.status();
      if (!available?.presage) throw new Error(available?.reasons[0] ?? 'Live Presage requires the Electron app and a configured key');
      const [{ SmartSpectraSDK: SDK, MetricType }, { decodeMetrics }] = await Promise.all([import('@smartspectra/node-sdk/renderer'), import('@smartspectra/node-sdk/messages')]);
      if (generation !== this.generation) return;
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 }, frameRate: { ideal: 30, max: 30 }, facingMode: 'user', ...(this.cameraDeviceId?{deviceId:{exact:this.cameraDeviceId}}:{}) }, audio: false });
      if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream; this.publishPreview();
      stream.getTracks().forEach(track => track.addEventListener('ended', () => { if (generation === this.generation) void this.unavailable('Camera stopped or permission revoked'); }, { once: true }));
      const sdk = new SDK({ requestedMetrics: [MetricType.PULSE_RATE], enableTelemetry: false, sendTimeoutMs: 8000 });
      this.sdk = sdk;
      let validation: { code: number | null; hint: string } = { code: null, hint: 'Waiting for capture validation' };
      sdk.on('validationStatus', (code, _timestamp, hint) => { if (generation !== this.generation) return; validation = { code, hint }; if (code !== 0) { this.hint = hint; if (this.sample) { this.sample = { ...this.sample, quality: 'rejected', qualityReasons: [hint] }; this.trends.discard(); this.baseline.discardContinuity(); } this.publish(); } });
      sdk.on('metrics', buffer => {
        if (generation !== this.generation) return;
        const receiveMs = performance.now();
        try { this.accept(normalizePresage(decodeMetrics(buffer), receiveMs, Date.now(), this.startedAt, validation)); }
        catch { this.hint = 'Pulse payload could not be decoded'; this.sample = null; this.publish(); }
      });
      sdk.on('error', (code, _message) => { if (generation === this.generation) void this.unavailable(`Sensor error ${code} · capture stopped; neutral play remains available`); });
      sdk.useMediaStream(stream);
      this.startedAt = performance.now();
      await sdk.start();
      if (generation !== this.generation) return;
      this.status = 'calibrating'; this.hint = 'Face the camera in steady light · warming up for 12 seconds';
      this.timer = setInterval(() => {
        if (this.sample && performance.now() - this.sample.receivedMonotonicMs > 5000) this.hint = 'Stale sensor data · neutral gameplay';
        if (this.baseline.value === null && performance.now() - this.startedAt >= 60_000) this.hint = 'Calibration not ready · continue in manual mode';
        this.publish();
      }, 1000);
      this.publish();
    } catch (error) { if (generation === this.generation) await this.unavailable(error instanceof Error ? error.name==='NotFoundError'?'No webcam detected. Connect a camera, then retry.':error.name==='NotAllowedError'?'Camera permission denied. Allow camera access in system settings, then retry.':error.name==='NotReadableError'?'Camera is busy. Close the other camera app and retry.':error.message : 'Camera unavailable'); }
  }
  private async unavailable(hint: string): Promise<void> {
    if (this.disposed) return;
    this.generation++;
    await this.retireCapture('unavailable', hint);
  }
  setSimulatedElevated(value: boolean): void { this.elevated = value; }
  /** All observable state changes happen before the returned teardown promise settles.
   * Later completion cannot publish over a newer start/resume command. */
  private retireCapture(status: SensorView['status'], hint: string): Promise<void> {
    const retiring = this.stopResources();
    this.status = status; this.hint = hint; this.publish();
    return retiring;
  }
  private async stopResources(): Promise<void> {
    if (this.timer) clearInterval(this.timer); this.timer = null;
    const stream = this.stream; this.stream = null; this.publishPreview();
    const sdk = this.sdk; this.sdk = null;
    this.sample = null; this.trends.discard(); this.baseline.discardContinuity();
    stream?.getTracks().forEach(track => { try { track.stop(); } catch { /* Already stopped track must not block SDK retirement. */ } });
    const previous = this.retiring;
    this.retiring = (async () => {
      await previous;
      if (sdk) { try { await sdk.stop(); } catch { /* already stopped */ } finally { try { sdk.destroy(); } catch { /* bridge already torn down */ } } }
    })();
    await this.retiring;
  }
  async stop(): Promise<void> {
    if (this.disposed) return;
    this.generation++;
    await this.retireCapture('manual', 'Capture stopped · neutral gameplay');
  }
  async pause(): Promise<void> {
    if (this.disposed) return;
    this.generation++;
    await this.retireCapture('paused', 'Capture paused · stale data discarded');
  }
  async resume(): Promise<void> { await this.start(this.mode, true); }
  async dispose(): Promise<void> { this.disposed = true; this.generation++; this.listeners.clear(); this.sampleListeners.clear(); this.previewListeners.clear(); await this.stopResources(); }
}
