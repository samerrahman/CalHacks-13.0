import { SpeechQueue, type SpeechRequest } from './queue';

export const EFFECT_NAMES = ['room_hum', 'radio_static', 'radio_chime', 'knock', 'shutter_motor', 'relay_click', 'warning_pulse', 'mimic_rustle', 'success'] as const;
export type EffectName = typeof EFFECT_NAMES[number];
export interface AudioEngine {
  start(): Promise<void>;
  setVolume(value: number): void;
  setMuted(value: boolean): void;
  setPaused(value: boolean): void;
  setListenerYaw(radians: number): void;
  playEffect(name: EffectName, side?: 'left' | 'right', volume?: number): void;
  speak(request: SpeechRequest): boolean;
  update(now: number, isValid?: (request: SpeechRequest) => boolean): void;
  reset(): void;
  dispose(): void;
  diagnostics: { status: 'idle' | 'ready' | 'unavailable'; loadedEffects: string[]; speech: 'idle' | 'live' | 'caption'; error: string | null };
}

/** Bounded Web Audio bus. Both genuine and fake speech take this exact radio path. */
export function createAudioEngine(): AudioEngine {
  let context: AudioContext | null = null, master: GainNode | null = null;
  let ambient: AudioBufferSourceNode | null = null, speechSource: AudioBufferSourceNode | null = null;
  let volume = .55, muted = false, paused = false, disposed = false, now = 0, generation = 0;
  let startPromise: Promise<void> | null = null, speechController: AbortController | null = null;
  const loadingController = new AbortController();
  const buffers = new Map<EffectName, AudioBuffer>(), active = new Set<AudioBufferSourceNode>();
  const queue = new SpeechQueue();
  const diagnostics: AudioEngine['diagnostics'] = { status: 'idle', loadedEffects: [], speech: 'idle', error: null };
  function audioFailure(error: unknown): void {
    if (disposed) return;
    diagnostics.status = 'unavailable'; diagnostics.error = error instanceof Error ? error.message : String(error);
  }

  function stopSpeech(): void {
    generation++; speechController?.abort(); speechController = null;
    if (speechSource) { try { speechSource.stop(); } catch { /* Already ended. */ } speechSource.disconnect(); speechSource = null; }
    diagnostics.speech = 'idle';
  }
  function playBuffer(buffer: AudioBuffer, gainValue: number, side?: 'left' | 'right', radio = false): AudioBufferSourceNode | null {
    if (!context || !master || disposed || paused || active.size >= 8) return null;
    const source = context.createBufferSource(); source.buffer = buffer;
    const gain = context.createGain(); gain.gain.value = Math.min(.85, Math.max(0, gainValue));
    const nodes: AudioNode[] = [gain];
    if (radio) {
      const high = context.createBiquadFilter(); high.type = 'highpass'; high.frequency.value = 350;
      const low = context.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 2900;
      source.connect(high); high.connect(low); low.connect(gain); nodes.push(high, low);
    } else source.connect(gain);
    const position = context.createPanner(); position.panningModel = 'HRTF'; position.distanceModel = 'inverse'; position.refDistance = 3; position.rolloffFactor = .55;
    position.positionX.value = side === 'left' ? -4 : side === 'right' ? 4 : -.8;
    position.positionY.value = radio ? 1.1 : 1.4;
    position.positionZ.value = side ? 0 : -1.7;
    gain.connect(position); position.connect(master); nodes.push(position);
    active.add(source);
    source.onended = () => { active.delete(source); source.disconnect(); nodes.forEach(node => node.disconnect()); };
    source.start(); return source;
  }
  function effect(name: EffectName, side?: 'left' | 'right', level = .6): void {
    const buffer = buffers.get(name); if (buffer) playBuffer(buffer, level, side);
  }
  function fallback(request: SpeechRequest): void {
    diagnostics.speech = 'caption'; effect('radio_chime', undefined, .5); queue.finish(request.id);
  }
  async function playSpeech(request: SpeechRequest): Promise<void> {
    if (!context || disposed || request.expiresAt <= now) { queue.finish(request.id); return; }
    if (!request.audioUrl && !request.audioBase64) { fallback(request); return; }
    const version = ++generation, controller = new AbortController(); speechController = controller;
    const timeout = globalThis.setTimeout(() => controller.abort(), 3500);
    try {
      let bytes: ArrayBuffer;
      if (request.audioBase64) {
        const binary = atob(request.audioBase64); const values = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) values[i] = binary.charCodeAt(i);
        bytes = values.buffer;
      } else {
        const response = await fetch(request.audioUrl!, { signal: controller.signal });
        if (!response.ok) throw new Error(`Speech audio returned ${response.status}`);
        bytes = await response.arrayBuffer();
      }
      const buffer = await context.decodeAudioData(bytes);
      // The game may have changed while the provider or decoder was working.
      if (disposed || version !== generation || queue.active?.id !== request.id || request.expiresAt <= now) return;
      const source = playBuffer(buffer, .78, undefined, true);
      if (!source) { fallback(request); return; }
      speechSource = source; diagnostics.speech = 'live';
      const ended = source.onended;
      source.onended = event => {
        ended?.call(source, event);
        if (speechSource === source) { speechSource = null; queue.finish(request.id); diagnostics.speech = 'idle'; }
      };
    } catch {
      if (!disposed && version === generation && queue.active?.id === request.id) fallback(request);
    } finally { globalThis.clearTimeout(timeout); if (speechController === controller) speechController = null; }
  }

  return {
    diagnostics,
    async start() {
      if (disposed) return;
      if (context?.state === 'suspended') {
        try { await context.resume(); } catch (error) { audioFailure(error); return; }
      }
      if (startPromise) return startPromise;
      startPromise = (async () => {
        try {
          context = new AudioContext({ latencyHint: 'interactive' }); await context.resume();
          master = context.createGain(); master.gain.value = muted ? 0 : Math.min(.7, volume);
          const limiter = context.createDynamicsCompressor(); limiter.threshold.value = -12; limiter.knee.value = 8; limiter.ratio.value = 10; limiter.attack.value = .003; limiter.release.value = .18;
          master.connect(limiter); limiter.connect(context.destination);
          context.listener.positionX.value = 0; context.listener.positionY.value = 1.65; context.listener.positionZ.value = 1.4;
          context.listener.forwardZ.value = -1; context.listener.upY.value = 1;
          await Promise.all(EFFECT_NAMES.map(async name => {
            const response = await fetch(`/assets/audio/${name}.wav`, { signal: loadingController.signal });
            if (!response.ok) throw new Error(`${name} returned ${response.status}`);
            const buffer = await context!.decodeAudioData(await response.arrayBuffer());
            if (!disposed) { buffers.set(name, buffer); diagnostics.loadedEffects.push(name); }
          }));
          if (disposed || !context || !master) return;
          ambient = context.createBufferSource(); ambient.buffer = buffers.get('room_hum')!; ambient.loop = true;
          const ambientGain = context.createGain(); ambientGain.gain.value = .65; ambient.connect(ambientGain); ambientGain.connect(master); ambient.start();
          if (paused) await context.suspend();
          diagnostics.status = 'ready';
        } catch (error) { audioFailure(error); }
      })();
      return startPromise;
    },
    setVolume(value) { volume = Math.min(.7, Math.max(0, value)); if (master && context) master.gain.setTargetAtTime(muted ? 0 : volume, context.currentTime, .04); },
    setMuted(value) { muted = value; if (master && context) master.gain.setTargetAtTime(muted ? 0 : volume, context.currentTime, .04); },
    setPaused(value) {
      paused = value; if (!context || disposed || context.state === 'closed') return;
      void (value ? context.suspend() : context.resume()).catch(audioFailure);
    },
    setListenerYaw(radians) {
      if (!context) return;
      context.listener.forwardX.value = -Math.sin(radians); context.listener.forwardY.value = 0; context.listener.forwardZ.value = -Math.cos(radians);
    },
    playEffect: effect,
    speak(request) {
      const result = queue.enqueue(request, now); if (result.interrupted) stopSpeech();
      if (result.accepted) effect('radio_static', undefined, .12); return result.accepted;
    },
    update(gameTime, isValid = () => true) {
      now = gameTime; if (queue.prune(now, isValid)) stopSpeech();
      if (paused || disposed || !context) return;
      const next = queue.next(now); if (next) void playSpeech(next);
    },
    reset() {
      stopSpeech(); queue.reset(); now = 0;
      for (const source of active) { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); } active.clear();
    },
    dispose() {
      if (disposed) return; disposed = true; loadingController.abort(); stopSpeech(); queue.reset();
      for (const source of active) { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); } active.clear();
      ambient?.stop(); ambient?.disconnect(); buffers.clear(); master?.disconnect(); if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    },
  };
}
