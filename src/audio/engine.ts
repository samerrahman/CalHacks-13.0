import { SpeechQueue, type SpeechRequest } from './queue';

export const EFFECT_NAMES = ['intro_alarm', 'forest_run', 'door_slam', 'room_hum', 'fault_rattle', 'fault_silenced', 'machine_mistake', 'relay_confirm', 'terminal_press', 'sequence_tone_1', 'sequence_tone_2', 'sequence_tone_3', 'sequence_tone_4', 'lure_heartbeat', 'lure_transmit', 'steps_approaching', 'steps_receding', 'wall_breath', 'wall_scrape', 'breach_warning', 'breach_impact', 'blackout', 'power_restart', 'containment_success', 'radio_static', 'radio_chime', 'monitor_interrupt',
  'creature_step_1', 'creature_step_2', 'creature_step_3', 'creature_step_4', 'wall_pound_1', 'wall_pound_2', 'wall_pound_3', 'creature_growl_1', 'creature_growl_2', 'creature_scream',
  'ambient_creak_1', 'ambient_creak_2', 'ambient_snap', 'ambient_groan', 'ambient_howl', 'ambience_wind', 'ambience_crickets'] as const;
export type EffectName = typeof EFFECT_NAMES[number];
export type AudioPosition = [number, number, number];
export type ScareKind = 'impact' | 'monitor' | 'breach';
const LIMITER_DB = -12, BREACH_LIMITER_DB = -1, SCREAM_BOOST = 3.2, SCREAM_CAP = 1.6;
export type SpeechEvent =
  | { type: 'started'; id: string; text: string; mode: 'live' | 'cached' | 'caption' }
  | { type: 'ended' | 'cancelled'; id: string }
  | { type: 'idle' };

/** A readable fallback must hold its place just as recorded speech does. */
export function captionReadingSeconds(text: string): number {
  return Math.max(3, Math.min(14, text.trim().split(/\s+/).length / 2.6 + 1));
}
export interface AudioWorld {
  time: number;
  power: 'on' | 'quiet' | 'blackout';
  paused?: boolean;
  /** A seeded hunt is under way: footsteps break into a run. */
  hunting?: boolean;
  /** Fault-sound id (0 thump, 1 whine, 2 ticking, 3 buzz) for each machine this stage. */
  faultSounds?: number[];
  /** Machine whose sound the rack key is playing right now. */
  listening?: number | null;
  softScares?: boolean;
  faults: number[];
  creature: { position: AudioPosition; distance: number; phase: string; lastMotion: 'approaching' | 'receding' | 'stationary' | 'circling' };
  lure?: { position: AudioPosition; active: boolean } | null;
}
export interface AudioEngine {
  start(): Promise<void>;
  setVolume(value: number): void;
  setMuted(value: boolean): void;
  setPaused(value: boolean): void;
  setListenerYaw(radians: number): void;
  setListenerPosition(position: AudioPosition): void;
  playEffect(name: EffectName, position?: AudioPosition, volume?: number): void;
  playScare(kind: ScareKind, position?: AudioPosition, soft?: boolean): void;
  speak(request: SpeechRequest): boolean;
  subscribeSpeech(listener: (event: SpeechEvent) => void): () => void;
  isSpeechBusy(): boolean;
  cancelSpeech(id?: string): void;
  update(now: number, isValid?: (request: SpeechRequest) => boolean): void;
  updateWorld(state: AudioWorld): void;
  reset(): void;
  dispose(): void;
  diagnostics: { status: 'idle' | 'ready' | 'unavailable'; loadedEffects: string[]; speech: 'idle' | 'live' | 'cached' | 'caption'; error: string | null; decodedSpeech: number; startedSpeech: number; playbackErrors: number; contextState: AudioContextState | 'uninitialized'; startedScares: number; footsteps: number; lastFootstepGain: number; wallPounds: number; ambientOneShots: number };
}

/** Bounded Web Audio bus. Authored radio and creature speech share this bounded playback path. */
export function createAudioEngine(): AudioEngine {
  let context: AudioContext | null = null, master: GainNode | null = null;
  let speechSource: AudioBufferSourceNode | null = null;
  let speechRequest: SpeechRequest | null = null, captionUntil: number | null = null;
  const speechListeners = new Set<(event: SpeechEvent) => void>();
  let volume = .55, muted = false, paused = false, disposed = false, now = 0, generation = 0;
  let startPromise: Promise<void> | null = null, speechController: AbortController | null = null;
  const loadingController = new AbortController();
  const buffers = new Map<EffectName, AudioBuffer>(), active = new Set<AudioBufferSourceNode>();
  const positions = new Map<AudioBufferSourceNode, PannerNode>();
  const creatureAttached = new Set<AudioBufferSourceNode>();
  const loops = new Map<string, { source: AudioBufferSourceNode; gain: GainNode; panner: PannerNode }>();
  const scareTones = new Set<OscillatorNode>();
  const scareBuffers = new Set<AudioBufferSourceNode>();
  let lastScareAt = -Infinity, limiter: DynamicsCompressorNode | null = null, scareBus: GainNode | null = null, noise: AudioBuffer | null = null;
  const curves = new Map<number, Float32Array<ArrayBuffer>>();
  let signatures: AudioBuffer[] = [], lastListening: number | null = null;
  let breathSource: AudioBufferSourceNode | null = null, nextBreathAt = 0, nextScrapeAt = 0, lastWorldTime = 0;
  let nextFootstepAt = 0, nextPoundAt = 0, nextGrowlAt = 0, nextAmbientAt = 8, stepSide = 0, running = false, barrage = false;
  const queue = new SpeechQueue();
  const diagnostics: AudioEngine['diagnostics'] = { status: 'idle', loadedEffects: [], speech: 'idle', error: null, decodedSpeech: 0, startedSpeech: 0, playbackErrors: 0, contextState: 'uninitialized', startedScares: 0, footsteps: 0, lastFootstepGain: 0, wallPounds: 0, ambientOneShots: 0 };
  /** The breach scream follows the volume slider and mute, boosted well above the master mix. */
  function scareLevel(): number { return muted ? 0 : Math.min(SCREAM_CAP, volume * SCREAM_BOOST); }
  function syncContextState(): void { diagnostics.contextState = context?.state ?? 'uninitialized'; }
  function audioFailure(error: unknown): void {
    if (disposed) return;
    syncContextState();
    diagnostics.status = 'unavailable'; diagnostics.error = error instanceof Error ? error.message : String(error);
  }

  function emitSpeech(event: SpeechEvent): void {
    for (const listener of speechListeners) listener(event);
  }
  function emitIdle(): void { if (!queue.active && !queue.length) emitSpeech({ type: 'idle' }); }
  function stopSpeech(): void {
    generation++; speechController?.abort(); speechController = null;
    const request = speechRequest; speechRequest = null; captionUntil = null;
    const source = speechSource; speechSource = null;
    if (source) { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); }
    diagnostics.speech = 'idle';
    if (request) emitSpeech({ type: 'cancelled', id: request.id });
    emitIdle();
  }
  function cancelSpeech(id?: string): void {
    const playingId = speechRequest?.id;
    const removed = queue.cancel(id);
    if (!id || playingId === id) stopSpeech();
    for (const request of removed) if (request.id !== playingId) emitSpeech({ type: 'cancelled', id: request.id });
    if (id && playingId !== id) emitIdle();
  }
  function finishSpeech(request: SpeechRequest): void {
    if (speechRequest?.id !== request.id) return;
    speechSource = null; speechRequest = null; captionUntil = null;
    queue.finish(request.id); diagnostics.speech = 'idle';
    emitSpeech({ type: 'ended', id: request.id }); emitIdle();
  }
  function setPosition(panner: PannerNode, location: AudioPosition): void {
    panner.positionX.value = location[0]; panner.positionY.value = location[1]; panner.positionZ.value = location[2];
  }
  function makePanner(location: AudioPosition): PannerNode {
    const panner = context!.createPanner(); panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.refDistance = 4; panner.rolloffFactor = .65; setPosition(panner, location); return panner;
  }
  function stopScareTones(): void {
    for (const source of scareTones) { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); }
    scareTones.clear();
    for (const source of scareBuffers) { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); }
    scareBuffers.clear();
    if (limiter && context) { limiter.threshold.cancelScheduledValues(context.currentTime); limiter.threshold.setValueAtTime(LIMITER_DB, context.currentTime); }
  }
  function loop(key: string, name: EffectName | AudioBuffer, level: number, location: AudioPosition): void {
    const buffer = typeof name === 'string' ? buffers.get(name) : name;
    if (!context || !master || disposed || !buffer) return;
    let current = loops.get(key);
    if (current && current.source.buffer !== buffer) { try { current.source.stop(); } catch { /* Already ended. */ } current.source.disconnect(); current.gain.disconnect(); current.panner.disconnect(); loops.delete(key); current = undefined; }
    if (!current && level > 0) {
      const source = context.createBufferSource(); source.buffer = buffer; source.loop = true;
      const gain = context.createGain(); gain.gain.value = 0; const panner = makePanner(location);
      source.connect(gain); gain.connect(panner); panner.connect(master); source.start();
      current = { source, gain, panner }; loops.set(key, current);
    }
    if (current) { current.gain.gain.setTargetAtTime(Math.max(0, Math.min(.6, level)), context.currentTime, .06); setPosition(current.panner, location); }
  }
  function stopLoops(): void {
    for (const value of loops.values()) { try { value.source.stop(); } catch { /* Already ended. */ } value.source.disconnect(); value.gain.disconnect(); value.panner.disconnect(); } loops.clear();
  }
  function stopMovement(): void {
    nextFootstepAt = 0; nextPoundAt = 0; nextGrowlAt = 0; nextAmbientAt = 8; running = false; barrage = false;
  }
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;
  /** Direction-only placement for the creature soundscape: loudness comes from the explicit distance curve. */
  function playAt(name: EffectName, gainValue: number, location: AudioPosition, rate = 1): AudioBufferSourceNode | null {
    const buffer = buffers.get(name); if (!buffer) return null;
    const source = playBuffer(buffer, gainValue, location, false, 0);
    if (source) source.playbackRate.value = rate;
    return source;
  }
  function playBuffer(buffer: AudioBuffer, gainValue: number, location: AudioPosition = [-1.3, 1.1, -1.8], radio = false, rolloff?: number): AudioBufferSourceNode | null {
    // Bounded polyphony: room for a hunt's run, a pounding barrage, effects and radio speech at once.
    if (!context || !master || disposed || paused || active.size >= 16) return null;
    const source = context.createBufferSource(); source.buffer = buffer;
    const gain = context.createGain(); gain.gain.value = Math.min(.85, Math.max(0, gainValue));
    const nodes: AudioNode[] = [gain];
    if (radio) {
      const high = context.createBiquadFilter(); high.type = 'highpass'; high.frequency.value = 350;
      const low = context.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 2900;
      source.connect(high); high.connect(low); low.connect(gain); nodes.push(high, low);
    } else source.connect(gain);
    const position = makePanner(location); if (rolloff !== undefined) position.rolloffFactor = rolloff;
    gain.connect(position); position.connect(master); nodes.push(position);
    active.add(source); positions.set(source, position);
    source.onended = () => { active.delete(source); positions.delete(source); creatureAttached.delete(source); source.disconnect(); nodes.forEach(node => node.disconnect()); };
    source.start(); return source;
  }
  function effect(name: EffectName, location?: AudioPosition, level = .5): void {
    const buffer = buffers.get(name); if (buffer) playBuffer(buffer, level, location);
  }
  function playScare(kind: ScareKind, location?: AudioPosition, soft = false): void {
    if (!context || !master || disposed || paused || context.state !== 'running' || context.currentTime - lastScareAt < .65) return;
    lastScareAt = context.currentTime; stopScareTones();
    const impact = kind === 'breach' ? 'breach_impact' : kind === 'monitor' ? 'monitor_interrupt' : 'door_slam';
    const buffer = buffers.get(impact);
    const hit = buffer ? playBuffer(buffer, (kind === 'monitor' ? .43 : kind === 'breach' ? .8 : .58) * (soft ? .42 : 1), location) : null;
    if (hit) {
      scareBuffers.add(hit); const ended = hit.onended;
      hit.onended = event => { scareBuffers.delete(hit); ended?.call(hit, event); };
    }
    const tone = context.createOscillator(), envelope = context.createGain(), filter = context.createBiquadFilter();
    const position = makePanner(location ?? [-1.3, 1.1, -1.8]);
    const duration = kind === 'breach' ? .5 : kind === 'monitor' ? .19 : .32;
    const at = context.currentTime, attack = soft ? .035 : .008;
    tone.type = kind === 'monitor' ? 'triangle' : 'sine';
    tone.frequency.setValueAtTime(kind === 'monitor' ? 740 : kind === 'breach' ? 77 : 96, at);
    tone.frequency.exponentialRampToValueAtTime(kind === 'monitor' ? 155 : 34, at + duration);
    filter.type = 'lowpass'; filter.frequency.value = soft ? 700 : 1400;
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime((kind === 'monitor' ? .09 : .28) * (soft ? .42 : 1), at + attack);
    envelope.gain.exponentialRampToValueAtTime(.0001, at + duration);
    tone.connect(filter); filter.connect(envelope); envelope.connect(position); position.connect(master);
    scareTones.add(tone); diagnostics.startedScares++;
    tone.onended = () => { scareTones.delete(tone); tone.disconnect(); filter.disconnect(); envelope.disconnect(); position.disconnect(); };
    tone.start(at); tone.stop(at + duration + .025);
    if (kind === 'breach') { scream(at, soft); recordedScream(soft); } else sting(kind, at, soft, location);
  }
  /** The CC0 creature scream rides on the same loud scare bus as the synthesized one. */
  function recordedScream(soft: boolean): void {
    if (!context || !master) return;
    // The recorded scream, a second lower scream as it lunges, then a growl as it holds on you.
    for (const [name, delay, rate, level] of [['creature_scream', 0, .92, .95], ['creature_scream', 1.5, .78, .9], ['creature_growl_1', 2.7, .82, .85]] as const) {
      const buffer = buffers.get(name); if (!buffer) continue;
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = buffer; source.playbackRate.value = rate; gain.gain.value = soft ? level * .25 : level;
      source.connect(gain); gain.connect(soft || !scareBus ? master : scareBus);
      scareBuffers.add(source);
      source.onended = () => { scareBuffers.delete(source); source.disconnect(); gain.disconnect(); };
      source.start(context.currentTime + delay);
    }
  }
  /** Four seamless 1.2-second machine fault sounds, each built from whole cycles so it loops cleanly. */
  function buildSignatures(): AudioBuffer[] {
    const rate = context!.sampleRate, length = Math.round(rate * 1.2);
    let seed = 0x7a11;
    const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; };
    return [0, 1, 2, 3].map(kind => {
      const buffer = context!.createBuffer(1, length, rate), data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / rate;
        data[i] = kind === 0 ? .55 * Math.exp(-(t % .6) / .14) * (Math.sin(2 * Math.PI * 62 * t) + .35 * Math.sin(2 * Math.PI * 124 * t))
          : kind === 1 ? .22 * Math.sin(2 * Math.PI * 1650 * t + 5 * Math.sin(2 * Math.PI * 5 * t)) + .05 * Math.sin(2 * Math.PI * 3300 * t)
            : kind === 2 ? (t % .1 < .004 ? .5 * noise() : 0)
              : .26 * (.6 + .4 * Math.sin(2 * Math.PI * 5 * t)) * [1, 3, 5, 7, 9, 11].reduce((sum, h) => sum + Math.sin(2 * Math.PI * 100 * h * t) / h, 0);
      }
      return buffer;
    });
  }
  function noiseBuffer(): AudioBuffer {
    if (!noise) {
      noise = context!.createBuffer(1, Math.round(context!.sampleRate * 2), context!.sampleRate);
      const data = noise.getChannelData(0); let seed = 0x5eed;
      for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; data[i] = seed / 2147483648 - 1; }
    }
    return noise;
  }
  function distortion(amount: number): Float32Array<ArrayBuffer> {
    let curve = curves.get(amount);
    if (!curve) { curve = new Float32Array(1024); for (let i = 0; i < curve.length; i++) { const x = i * 2 / curve.length - 1; curve[i] = (1 + amount) * x / (1 + amount * Math.abs(x)); } curves.set(amount, curve); }
    return curve;
  }
  /** Shared scare nodes are released once every source feeding them has ended. */
  function scareGraph(nodes: AudioNode[]): (source: OscillatorNode | AudioBufferSourceNode, from: number, until: number) => void {
    let pending = 0;
    return (source, from, until) => {
      pending++;
      if ('buffer' in source) scareBuffers.add(source); else scareTones.add(source);
      source.onended = () => {
        if ('buffer' in source) scareBuffers.delete(source); else scareTones.delete(source);
        source.disconnect(); if (--pending === 0) nodes.forEach(node => node.disconnect());
      };
      source.start(from); source.stop(until);
    };
  }
  function envelope(at: number, peak: number, attack: number, hold: number, release: number): GainNode {
    const gain = context!.createGain();
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(peak, at + attack);
    gain.gain.setValueAtTime(peak, at + attack + hold); gain.gain.exponentialRampToValueAtTime(.0001, at + attack + hold + release);
    return gain;
  }
  /** The breach scream is a voice, not a tone: three detuned sawtooth "vocal folds"
   * glide up into a strained, vibrating shriek and crack down, shaped by open-vowel
   * formants, with rasp and growl, then distorted. It is non-positional and runs on its
   * own scare bus straight into the limiter, which is briefly opened to -1 dB, so it is
   * far louder than any other sound while still following volume and mute. */
  function scream(at: number, soft: boolean): void {
    const end = at + 3.4;
    const drive = context!.createGain(); drive.gain.value = soft ? 1 : 3.2;
    const shaper = context!.createWaveShaper(); shaper.curve = distortion(soft ? 3 : 16); shaper.oversample = '2x';
    const bus = context!.createGain(); bus.gain.value = soft ? .3 : .95;
    drive.connect(shaper); shaper.connect(bus); bus.connect(soft || !scareBus ? master! : scareBus);
    const vibrato = context!.createOscillator(), vibratoDepth = context!.createGain(), jitter = context!.createOscillator(), jitterDepth = context!.createGain();
    vibrato.frequency.setValueAtTime(5.5, at); vibrato.frequency.linearRampToValueAtTime(8, at + 1.2); vibratoDepth.gain.value = soft ? 25 : 60; vibrato.connect(vibratoDepth);
    jitter.type = 'triangle'; jitter.frequency.value = 23; jitterDepth.gain.value = soft ? 6 : 22; jitter.connect(jitterDepth);
    const voice = envelope(at, .55, soft ? .05 : .006, 2.6, .7), nodes: AudioNode[] = [drive, shaper, bus, vibratoDepth, jitterDepth, voice];
    // Open "AAH" formants: the difference between a siren and a throat.
    for (const [frequency, q, level] of [[850, 6, 1], [1250, 7, .8], [2900, 9, .55], [3500, 10, .3]]) {
      const formant = context!.createBiquadFilter(), gain = context!.createGain();
      formant.type = 'bandpass'; formant.frequency.value = frequency; formant.Q.value = q; gain.gain.value = level;
      voice.connect(formant); formant.connect(gain); gain.connect(drive); nodes.push(formant, gain);
    }
    const growl = envelope(at, .3, .02, 2.4, .9), growlTone = context!.createBiquadFilter();
    growlTone.type = 'lowpass'; growlTone.frequency.value = 700; growl.connect(growlTone); growlTone.connect(drive);
    const rasp = envelope(at, .32, soft ? .04 : .004, 2.3, .9), raspTone = context!.createBiquadFilter();
    raspTone.type = 'bandpass'; raspTone.frequency.setValueAtTime(1500, at); raspTone.frequency.exponentialRampToValueAtTime(900, end); raspTone.Q.value = 1.5;
    rasp.connect(raspTone); raspTone.connect(drive); nodes.push(growl, growlTone, rasp, raspTone);
    const start = scareGraph(nodes);
    const contour = (osc: OscillatorNode, scale: number) => {
      osc.frequency.setValueAtTime(380 * scale, at); osc.frequency.exponentialRampToValueAtTime(980 * scale, at + .18);
      osc.frequency.linearRampToValueAtTime(1080 * scale, at + 1.6); osc.frequency.exponentialRampToValueAtTime(820 * scale, at + 2.6); osc.frequency.exponentialRampToValueAtTime(560 * scale, end);
    };
    for (const cents of [-12, 0, 17]) {
      const fold = context!.createOscillator(); fold.type = 'sawtooth'; fold.detune.value = cents; contour(fold, 1);
      vibratoDepth.connect(fold.detune); jitterDepth.connect(fold.detune); fold.connect(voice); start(fold, at, end);
    }
    const low = context!.createOscillator(); low.type = 'sawtooth'; contour(low, .5); vibratoDepth.connect(low.detune); low.connect(growl); start(low, at, end);
    const hiss = context!.createBufferSource(); hiss.buffer = noiseBuffer(); hiss.loop = true; hiss.connect(rasp);
    start(hiss, at, end); start(vibrato, at, end); start(jitter, at, end);
    if (limiter && !soft) { limiter.threshold.cancelScheduledValues(at); limiter.threshold.setValueAtTime(BREACH_LIMITER_DB, at); limiter.threshold.setTargetAtTime(LIMITER_DB, end, .2); }
  }
  /** Short horror stab for nonfatal scares, routed from the scare's position. */
  function sting(kind: ScareKind, at: number, soft: boolean, location?: AudioPosition): void {
    const monitor = kind === 'monitor', scale = soft ? .42 : 1;
    const bus = context!.createGain(); bus.gain.value = scale;
    const position = makePanner(location ?? [-1.3, 1.1, -1.8]); bus.connect(position); position.connect(master!);
    const burst = envelope(at, monitor ? .3 : .38, .004, monitor ? .18 : .02, monitor ? .3 : .32), burstTone = context!.createBiquadFilter();
    burstTone.type = monitor ? 'bandpass' : 'highpass'; burstTone.frequency.value = monitor ? 3400 : 1800; burstTone.Q.value = .7;
    burst.connect(burstTone); burstTone.connect(bus);
    const stab = envelope(at, monitor ? .1 : .16, .01, .05, monitor ? .4 : .7), stabTone = context!.createBiquadFilter();
    stabTone.type = 'lowpass'; stabTone.frequency.value = soft ? 1800 : 4200; stab.connect(stabTone); stabTone.connect(bus);
    const start = scareGraph([bus, position, burst, burstTone, stab, stabTone]), end = at + (monitor ? .55 : .85);
    for (const base of monitor ? [1480, 1568] : [880, 932, 1318]) {
      const voice = context!.createOscillator(); voice.type = monitor ? 'triangle' : 'sawtooth';
      voice.frequency.setValueAtTime(base, at); voice.frequency.exponentialRampToValueAtTime(base * .92, end);
      voice.connect(stab); start(voice, at, end);
    }
    const hiss = context!.createBufferSource(); hiss.buffer = noiseBuffer(); hiss.connect(burst); start(hiss, at, end);
  }
  function fallback(request: SpeechRequest): void {
    if (disposed || speechRequest?.id !== request.id || queue.active?.id !== request.id) return;
    diagnostics.speech = 'caption';
    const duration = request.captionDuration;
    captionUntil = now + (duration !== undefined && Number.isFinite(duration) ? Math.max(3, Math.min(14, duration)) : captionReadingSeconds(request.text));
    queue.markStarted(request.id); effect('radio_chime', undefined, .5);
    emitSpeech({ type: 'started', id: request.id, text: request.text, mode: 'caption' });
  }
  async function playSpeech(request: SpeechRequest): Promise<void> {
    if (disposed || request.expiresAt <= now) { queue.finish(request.id); emitSpeech({ type: 'cancelled', id: request.id }); emitIdle(); return; }
    speechRequest = request;
    if (!context || context.state !== 'running' || (!request.audioUrl && !request.audioBase64)) { fallback(request); return; }
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
      diagnostics.decodedSpeech++; syncContextState();
      // The game may have changed while the provider or decoder was working.
      if (disposed || version !== generation || queue.active?.id !== request.id || request.expiresAt <= now) return;
      const source = playBuffer(buffer, .65, request.position, true);
      if (!source) { fallback(request); return; }
      diagnostics.startedSpeech++;
      speechSource = source; diagnostics.speech = request.source === 'cached' ? 'cached' : 'live';
      queue.markStarted(request.id);
      if (request.followCreature) creatureAttached.add(source);
      const ended = source.onended;
      source.onended = event => {
        ended?.call(source, event);
        if (speechSource === source) finishSpeech(request);
      };
      emitSpeech({ type: 'started', id: request.id, text: request.text, mode: request.source === 'cached' ? 'cached' : 'live' });
    } catch {
      if (!disposed && version === generation && queue.active?.id === request.id) { diagnostics.playbackErrors++; fallback(request); }
    } finally { globalThis.clearTimeout(timeout); if (speechController === controller) speechController = null; }
  }

  return {
    diagnostics,
    async start() {
      if (disposed) return;
      if (context?.state === 'suspended') {
        try { await context.resume(); syncContextState(); } catch (error) { audioFailure(error); return; }
      }
      if (startPromise) return startPromise;
      startPromise = (async () => {
        try {
          context = new AudioContext({ latencyHint: 'interactive' }); context.onstatechange = syncContextState; syncContextState(); await context.resume(); syncContextState();
          master = context.createGain(); master.gain.value = muted ? 0 : Math.min(.7, volume);
          limiter = context.createDynamicsCompressor(); limiter.threshold.value = LIMITER_DB; limiter.knee.value = 8; limiter.ratio.value = 10; limiter.attack.value = .003; limiter.release.value = .18;
          master.connect(limiter); limiter.connect(context.destination);
          scareBus = context.createGain(); scareBus.gain.value = scareLevel();
          // A gentle saturating clipper ahead of the limiter makes the scream dense as well as loud.
          const clip = context.createWaveShaper(); clip.curve = distortion(2.5); scareBus.connect(clip); clip.connect(limiter);
          context.listener.positionX.value = .05; context.listener.positionY.value = 1.62; context.listener.positionZ.value = .60;
          context.listener.forwardZ.value = -1; context.listener.upY.value = 1;
          await Promise.all(EFFECT_NAMES.map(async name => {
            const response = await fetch(`/assets/audio/${name}.wav`, { signal: loadingController.signal });
            if (!response.ok) throw new Error(`${name} returned ${response.status}`);
            const buffer = await context!.decodeAudioData(await response.arrayBuffer());
            if (!disposed) { buffers.set(name, buffer); diagnostics.loadedEffects.push(name); }
          }));
          if (disposed || !context || !master) return;
          signatures = buildSignatures();
          if (paused) await context.suspend(); syncContextState();
          diagnostics.status = 'ready';
        } catch (error) { audioFailure(error); }
      })();
      return startPromise;
    },
    setVolume(value) { volume = Math.min(.7, Math.max(0, value)); if (master && context) { master.gain.setTargetAtTime(muted ? 0 : volume, context.currentTime, .04); scareBus?.gain.setTargetAtTime(scareLevel(), context.currentTime, .04); } },
    setMuted(value) { muted = value; if (master && context) { master.gain.setTargetAtTime(muted ? 0 : volume, context.currentTime, .04); scareBus?.gain.setTargetAtTime(scareLevel(), context.currentTime, .04); } },
    setPaused(value) {
      paused = value; if (value) { cancelSpeech(); stopScareTones(); } if (!context || disposed || context.state === 'closed') return;
      void (value ? context.suspend() : context.resume()).then(syncContextState).catch(audioFailure);
    },
    setListenerYaw(radians) {
      if (!context) return;
      context.listener.forwardX.value = -Math.sin(radians); context.listener.forwardY.value = 0; context.listener.forwardZ.value = -Math.cos(radians);
    },
    setListenerPosition(position) {
      if (!context || !position.every(Number.isFinite)) return;
      context.listener.positionX.value = position[0]; context.listener.positionY.value = position[1]; context.listener.positionZ.value = position[2];
    },
    playEffect: effect,
    playScare,
    subscribeSpeech(listener) { speechListeners.add(listener); return () => { speechListeners.delete(listener); }; },
    isSpeechBusy() { return queue.active !== null || queue.length > 0; },
    cancelSpeech,
    speak(request) {
      if (disposed || paused) return false;
      const result = queue.enqueue(request, now); if (result.interrupted) stopSpeech();
      if (result.accepted) effect('radio_static', undefined, .12); return result.accepted;
    },
    update(gameTime, isValid = () => true) {
      now = gameTime; if (queue.prune(now, isValid)) stopSpeech();
      if (paused || disposed) return;
      if (captionUntil !== null && now >= captionUntil && speechRequest) finishSpeech(speechRequest);
      const next = queue.next(now); if (next) void playSpeech(next);
    },
    updateWorld(state) {
      if (disposed) return;
      if (state.time < lastWorldTime) { stopMovement(); nextBreathAt = 0; }
      lastWorldTime = state.time;
      const powered = state.power === 'on' && !state.paused, creature = state.creature;
      loop('room', 'room_hum', powered ? .46 : 0, [0, 2.8, -.5]);
      // Each failing machine plays its own fault sound from its rack slot; the player identifies it by ear.
      const rack = (i: number): AudioPosition => [2.42, i < 2 ? .53 : 1.45, .05 + (i % 2 ? .44 : -.44)];
      for (let i = 0; i < 4; i++) {
        const level = !state.paused && state.faults.includes(i) ? powered ? .3 : state.power === 'blackout' ? .08 : 0 : 0;
        const signature = signatures[state.faultSounds?.[i] ?? i];
        if (signature) loop(`fault-${i}`, signature, level, rack(i)); else loop(`fault-${i}`, 'fault_rattle', level, rack(i));
      }
      const key = state.paused ? null : state.listening ?? null;
      if (key !== lastListening) {
        lastListening = key;
        const signature = key === null ? undefined : signatures[state.faultSounds?.[key] ?? key];
        if (signature && key !== null) playBuffer(signature, .45, rack(key), false, 0);
      }
      loop('remote-lure', 'lure_heartbeat', state.lure?.active && !state.paused ? .58 : 0, state.lure?.position ?? [0, 0, -26]);
      // Night ambience: wind through the hull is clearer with the machines off; the crickets outside
      // fall silent as the creature closes in, which is itself a tell.
      loop('ambience-wind', 'ambience_wind', state.paused ? 0 : powered ? .2 : .32, [0, 2.4, .4]);
      loop('ambience-crickets', 'ambience_crickets', state.paused ? 0 : .1 * Math.max(0, Math.min(1, (creature.distance - 6) / 8)), [-4, .8, -7]);
      if (paused || state.paused || !context || context.state !== 'running') return;
      for (const source of creatureAttached) { const position = positions.get(source); if (position) setPosition(position, creature.position); }
      const closeness = Math.max(0, Math.min(1, 1 - creature.distance / 24)), soft = state.softScares ? .7 : 1;
      const range = Math.hypot(creature.position[0], creature.position[2]) || 1;
      const atWall: AudioPosition = [creature.position[0] / range * 3.3, 1.1, creature.position[2] / range * 3.3];
      const committed = creature.phase === 'breach';
      // A hunt breaks straight into a run and a committed attack straight into a barrage.
      if (!!state.hunting !== running) { running = !!state.hunting; if (running) nextFootstepAt = Math.min(nextFootstepAt, state.time + .15); }
      if (committed !== barrage) { barrage = committed; if (barrage) nextPoundAt = state.time; }
      // Footsteps carry the threat: louder and quicker the closer it is, a run during a hunt.
      if (!committed && creature.distance <= 22 && state.time >= nextFootstepAt) {
        const moving = state.hunting || creature.lastMotion === 'approaching' || creature.lastMotion === 'receding';
        const name = state.hunting || closeness > .8 ? pick(['creature_step_3', 'creature_step_4'] as const) : stepSide++ % 2 ? 'creature_step_2' : pick(['creature_step_1', 'creature_step_3'] as const);
        const gain = Math.min(.85, (.035 + .8 * closeness ** 1.7) * (state.hunting ? 1.25 : 1) * soft);
        if (playAt(name, gain, creature.position, (state.hunting ? 1.08 : .95) + Math.random() * .1)) { diagnostics.footsteps++; diagnostics.lastFootstepGain = gain; }
        nextFootstepAt = state.time + (state.hunting ? .36 : moving ? 1 - closeness * .32 : 2.6) * (.9 + Math.random() * .2);
      }
      // At the wall it pounds on the hull; a committed attack is a rapid barrage.
      if ((committed || creature.distance <= 2) && state.time >= nextPoundAt) {
        if (playAt(pick(['wall_pound_1', 'wall_pound_2', 'wall_pound_3'] as const), (committed ? .85 : .55 + Math.random() * .15) * soft, atWall, .92 + Math.random() * .14)) diagnostics.wallPounds++;
        nextPoundAt = state.time + (committed ? .38 + Math.random() * .2 : 2.2 + Math.random() * 3.5);
      }
      if (!committed && creature.distance <= 5 && state.time >= nextGrowlAt) {
        if (nextGrowlAt > 0) { const source = playAt(pick(['creature_growl_1', 'creature_growl_2'] as const), .42 * soft, creature.position, .9 + Math.random() * .15); if (source) creatureAttached.add(source); }
        nextGrowlAt = state.time + 6 + Math.random() * 8;
      }
      // Now and then the night makes its own noises.
      if (state.time >= nextAmbientAt) {
        const name = pick(['ambient_creak_1', 'ambient_creak_2', 'ambient_groan', 'ambient_snap', ...(creature.distance >= 12 ? ['ambient_howl' as const] : [])] as const);
        const outside = name === 'ambient_snap' || name === 'ambient_howl', bearing = Math.random() * Math.PI * 2, far = outside ? 12 + Math.random() * 30 : 2.5;
        const where: AudioPosition = outside ? [Math.sin(bearing) * far, .5, -Math.cos(bearing) * far] : [(Math.random() - .5) * 5, 2.3, (Math.random() - .5) * 4];
        if (playAt(name, name === 'ambient_howl' ? .2 : outside ? .26 : .22, where, .9 + Math.random() * .2)) diagnostics.ambientOneShots++;
        nextAmbientAt = state.time + 9 + Math.random() * 16;
      }
      const nearListening = creature.distance <= 4.2 && ['listen', 'breach'].includes(creature.phase);
      if (!nearListening && breathSource) { try { breathSource.stop(); } catch { /* Already ended. */ } breathSource = null; }
      if (nearListening && state.time >= nextBreathAt) {
        const buffer = buffers.get('wall_breath'); if (buffer) { breathSource = playBuffer(buffer, .32, creature.position); if (breathSource) creatureAttached.add(breathSource); }
        nextBreathAt = state.time + 7;
      }
      if (creature.phase === 'circle' && creature.distance <= 4.2 && state.time >= nextScrapeAt) {
        const buffer = buffers.get('wall_scrape'); if (buffer) { const source = playBuffer(buffer, .28, creature.position); if (source) creatureAttached.add(source); }
        nextScrapeAt = state.time + 9;
      }
    },
    reset() {
      cancelSpeech(); stopMovement(); stopLoops(); stopScareTones(); lastScareAt = -Infinity; lastListening = null; queue.reset(); now = 0; lastWorldTime = 0; nextBreathAt = 0; nextScrapeAt = 0; breathSource = null;
      for (const source of active) { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); } active.clear();
      positions.clear(); creatureAttached.clear();
    },
    dispose() {
      if (disposed) return; disposed = true; loadingController.abort(); cancelSpeech(); stopMovement(); stopLoops(); stopScareTones(); queue.reset(); speechListeners.clear();
      for (const source of active) { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); } active.clear();
      positions.clear(); creatureAttached.clear(); buffers.clear(); noise = null; scareBus?.disconnect(); master?.disconnect(); if (context && context.state !== 'closed') void context.close().then(syncContextState).catch(() => undefined);
    },
  };
}
