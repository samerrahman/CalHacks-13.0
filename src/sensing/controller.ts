import { Baseline } from './baseline';
import { TrendTracker } from './trend';
import { NativeMetricStream } from './nativeMetrics';
import { sanitizeSensorError } from './sensorError';
import { validationBlocksMetric } from './metricPolicy';
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
  private native = new NativeMetricStream();
  private diagnosticPublishedAt = 0;
  subscribe(listener: (view: SensorView) => void): () => void { this.listeners.add(listener); listener(this.view()); return () => this.listeners.delete(listener); }
  /** Local-only recorder hook. Consumers must independently require report consent. */
  subscribeSamples(listener: (sample: SensorSample, captureSegment: number) => void): () => void { this.sampleListeners.add(listener); return () => this.sampleListeners.delete(listener); }
  view(): SensorView {
    const now = performance.now();
    const pulse = acceptedPulse(this.sample, now, this.mode === 'simulated');
    const usable = this.status === 'calibrating' || this.status === 'ready';
    const diagnostics = this.mode === 'presage' ? this.native.view(now, this.stream ? 'live' : this.status === 'starting' ? 'acquiring' : 'off') : undefined;
    return { source: this.mode, status: this.status, trend: usable && pulse !== null ? this.trends.classify(this.baseline.value, now, this.mode === 'simulated') : 'UNKNOWN', quality: usable && pulse !== null ? 'accepted' : this.sample?.quality === 'rejected' ? 'rejected' : 'unknown', hint: this.hint, baselineBpm: this.baseline.value, pulseBpm: usable ? pulse : null, ageMs: this.sample ? Math.max(0, now - this.sample.receivedMonotonicMs) : null, acceptedSeconds: Math.min(30, this.baseline.acceptedMs / 1000), canContinueManual: now - this.startedAt >= 60_000 || this.status === 'unavailable' || this.mode !== 'presage', sampleAtMs: usable && pulse !== null ? this.sample!.measuredMonotonicMs : null, captureSegment: this.captureSegment, ...(diagnostics ? { diagnostics } : {}) };
  }
  private publish(): void { const view = this.view(); this.listeners.forEach(l => l(view)); }
  private publishDiagnostics(force = false): void {
    const now = performance.now();
    if (!force && now - this.diagnosticPublishedAt < 250) return;
    this.diagnosticPublishedAt = now;
    const diagnostics = this.native.view(now, this.stream ? 'live' : 'acquiring');
    this.hint = diagnostics.blocker ?? (this.baseline.value === null ? 'Stable capture · collecting 30 usable seconds' : 'LIVE · accepted sustained pulse trend');
    this.publish();
  }
  private accept(sample: SensorSample): void {
    if (this.disposed) return;
    this.sample = sample;
    this.baseline.add(sample, performance.now(), this.mode === 'simulated');
    this.trends.add(sample);
    if (this.mode !== 'presage' || this.native.processingStatus === 'running') this.status = this.baseline.value === null ? 'calibrating' : 'ready';
    this.hint = sample.quality === 'accepted' ? this.mode === 'simulated' ? 'SIMULATED · development fixture, camera off' : this.baseline.value === null ? 'Stable capture · collecting 30 usable seconds' : 'LIVE · accepted sustained pulse trend' : sample.qualityReasons.join(' · ');
    this.sampleListeners.forEach(listener => listener({ ...sample, qualityReasons: [...sample.qualityReasons] }, this.captureSegment));
    this.publish();
  }
  private applyValidation(code: number, hint: string): void {
    const changed = code !== this.native.validation.code || hint !== this.native.validation.hint;
    this.native.setValidation(code, hint || (code === 0 ? 'Capture validated' : `Capture validation ${code}`));
    if (validationBlocksMetric(code, 'pulse') && this.sample) {
      this.sample = { ...this.sample, quality: 'rejected', qualityReasons: [this.native.validation.hint] };
      this.baseline.discardContinuity();
      // Immediately withhold the current reading, but don't erase historical
      // accepted measurements for a single frame's validation warning. Only a
      // new accepted metric may resume influence; rejected metrics and >5 s
      // gaps still make TrendTracker return UNKNOWN for its whole window.
    }
    this.publishDiagnostics(changed);
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
    this.trends.reset(); this.sample = null; this.startedAt = performance.now(); this.native = new NativeMetricStream();
    if (mode === 'manual') { this.status = 'manual'; this.hint = 'MANUAL · no camera or pulse data'; this.publish(); return; }
    this.status = 'starting'; this.hint = mode === 'presage' ? 'Checking native camera integration' : 'SIMULATED · development fixture'; this.publish();
    if (mode === 'simulated') {
      this.accept(simulatedSample(performance.now(), this.elevated));
      this.timer = setInterval(() => { if (generation === this.generation) this.accept(simulatedSample(performance.now(), this.elevated)); }, 1000);
      return;
    }
    try {
      const available = await window.hush?.status();
      if (!available?.presage) throw new Error(available?.reasons[0] ?? 'Live Presage requires the Electron app and a configured key');
      const [{ SmartSpectraSDK: SDK, MetricType }, { decodeMetrics }] = await Promise.all([import('@smartspectra/node-sdk/renderer'), import('@smartspectra/node-sdk/messages')]);
      if (generation !== this.generation) return;
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 }, frameRate: { ideal: 30, max: 30 }, facingMode: 'user', ...(this.cameraDeviceId?{deviceId:{exact:this.cameraDeviceId}}:{}) }, audio: false });
      if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream; this.publishPreview();
      stream.getTracks().forEach(track => track.addEventListener('ended', () => { if (generation === this.generation) void this.unavailable('Camera stopped or permission revoked'); }, { once: true }));
      const sdk = new SDK({ requestedMetrics: [MetricType.PULSE_RATE, MetricType.BREATHING_RATE], enableTelemetry: false, sendTimeoutMs: 8000 });
      this.sdk = sdk;
      sdk.on('processingStatus', code => {
        if (generation !== this.generation) return;
        this.native.processing(code);
        if (code === 3) this.status = this.baseline.value === null ? 'calibrating' : 'ready';
        else if (code === 0 || code === 1 || code === 2) this.status = 'starting';
        if (code !== 3) { this.sample = null; this.trends.discard(); this.baseline.discardContinuity(); }
        this.publishDiagnostics(true);
      });
      sdk.on('frameSentThrough', (sent, timestamp) => {
        if (generation !== this.generation) return;
        this.native.frame(sent, timestamp, performance.now()); this.publishDiagnostics();
      });
      sdk.on('validationStatus', (code, _timestamp, hint) => {
        if (generation !== this.generation) return;
        this.applyValidation(code, hint);
      });
      sdk.on('metrics', buffer => {
        if (generation !== this.generation) return;
        const receiveMs = performance.now();
        try {
          const sample = this.native.ingest(decodeMetrics(buffer), receiveMs, Date.now());
          if (sample) {
            if (this.native.processingStatus !== 'running') { sample.quality = 'rejected'; sample.qualityReasons.unshift(`Native processing: ${this.native.processingStatus}`); }
            this.accept(sample);
          } else this.publishDiagnostics();
        } catch { this.hint = 'Pulse payload could not be decoded'; this.sample = null; this.trends.discard(); this.baseline.discardContinuity(); this.publish(); }
      });
      sdk.on('error', (code, message) => { if (generation === this.generation) void this.unavailable(`Sensor error ${code}: ${sanitizeSensorError(message)} · capture stopped`); });
      sdk.useMediaStream(stream);
      this.startedAt = performance.now();
      await sdk.start();
      if (generation !== this.generation) return;
      this.status = this.native.processingStatus === 'running' ? 'calibrating' : 'starting';
      this.timer = setInterval(() => {
        this.publishDiagnostics(true);
      }, 1000);
      this.publishDiagnostics(true);
    } catch (error) { if (generation === this.generation) await this.unavailable(error instanceof Error ? error.name==='NotFoundError'?'No webcam detected. Connect a camera, then retry.':error.name==='NotAllowedError'?'Camera permission denied. Allow camera access in system settings, then retry.':error.name==='NotReadableError'?'Camera is busy. Close the other camera app and retry.':sanitizeSensorError(error) : 'Camera unavailable'); }
  }
  private async unavailable(hint: string): Promise<void> {
    if (this.disposed) return;
    this.generation++;
    this.native.failure ??= hint;
    this.native.processingStatus = 'error';
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
