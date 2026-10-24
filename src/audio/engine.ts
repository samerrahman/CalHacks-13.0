import { SpeechQueue, type SpeechRequest } from './queue';

export const EFFECT_NAMES = ['intro_alarm', 'forest_run', 'door_slam', 'room_hum', 'fault_rattle', 'fault_silenced', 'machine_mistake', 'relay_confirm', 'terminal_press', 'sequence_tone_1', 'sequence_tone_2', 'sequence_tone_3', 'sequence_tone_4', 'lure_heartbeat', 'lure_transmit', 'steps_approaching', 'steps_receding', 'wall_breath', 'wall_scrape', 'breach_warning', 'breach_impact', 'blackout', 'power_restart', 'containment_success', 'radio_static', 'radio_chime', 'monitor_interrupt'] as const;
export type EffectName = typeof EFFECT_NAMES[number];
export type AudioPosition = [number, number, number];
export type ScareKind = 'impact' | 'monitor' | 'breach';
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
  /** Core decides whether a late quiet action has already committed the alarm. */
  alarm?: { active: boolean; urgency: number };
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
  diagnostics: { status: 'idle' | 'ready' | 'unavailable'; loadedEffects: string[]; speech: 'idle' | 'live' | 'cached' | 'caption'; error: string | null; decodedSpeech: number; startedSpeech: number; playbackErrors: number; contextState: AudioContextState | 'uninitialized'; alarmActive: boolean; alarmPulseHz: number; startedScares: number };
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
  let alarm: { tones: OscillatorNode[]; pulse: OscillatorNode; gain: GainNode; depth: GainNode; filter: BiquadFilterNode; nodes: AudioNode[] } | null = null;
  const scareTones = new Set<OscillatorNode>();
  const scareBuffers = new Set<AudioBufferSourceNode>();
  let lastScareAt = -Infinity;
  let movementSource: AudioBufferSourceNode | null = null, breathSource: AudioBufferSourceNode | null = null, movementKind = '', nextStepsAt = 0, nextBreathAt = 0, nextScrapeAt = 0, lastWorldTime = 0;
  const queue = new SpeechQueue();
  const diagnostics: AudioEngine['diagnostics'] = { status: 'idle', loadedEffects: [], speech: 'idle', error: null, decodedSpeech: 0, startedSpeech: 0, playbackErrors: 0, contextState: 'uninitialized', alarmActive: false, alarmPulseHz: 0, startedScares: 0 };
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
  function stopAlarm(): void {
    if (alarm) {
      for (const oscillator of [...alarm.tones, alarm.pulse]) { try { oscillator.stop(); } catch { /* Already stopped. */ } oscillator.disconnect(); }
      for (const node of alarm.nodes) node.disconnect();
      alarm = null;
    }
    diagnostics.alarmActive = false; diagnostics.alarmPulseHz = 0;
  }
  function updateAlarm(activeAlarm: boolean, urgency: number, soft: boolean): void {
    if (!activeAlarm || paused || !context || !master || disposed || context.state !== 'running') { stopAlarm(); return; }
    const pressure = Number.isFinite(urgency) ? Math.max(0, Math.min(1, urgency)) : 0;
    if (!alarm) {
      // Two low horn partials share one smoothly pulsing envelope. No timer,
      // random threat clock or repeated oscillator allocation per render frame.
      const low = context.createOscillator(), upper = context.createOscillator(), pulse = context.createOscillator();
      low.type = 'sawtooth'; upper.type = 'triangle'; upper.detune.value = -7; pulse.type = 'sine';
      const lowGain = context.createGain(), upperGain = context.createGain(), gain = context.createGain(), depth = context.createGain();
      lowGain.gain.value = .55; upperGain.gain.value = .35; gain.gain.value = 0; depth.gain.value = 0;
      const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = .7;
      const position = makePanner([-1.6, 1.45, -1.3]);
      low.connect(lowGain); upper.connect(upperGain); lowGain.connect(filter); upperGain.connect(filter);
      filter.connect(gain); gain.connect(position); position.connect(master);
      pulse.connect(depth); depth.connect(gain.gain);
      alarm = { tones: [low, upper], pulse, gain, depth, filter, nodes: [lowGain, upperGain, gain, depth, filter, position] };
      low.start(); upper.start(); pulse.start();
    }
    const hz = .8 + pressure * 3.4;
    alarm.tones[0]!.frequency.setTargetAtTime(125 + pressure * 80, context.currentTime, .07);
    alarm.tones[1]!.frequency.setTargetAtTime((125 + pressure * 80) * 1.5, context.currentTime, .07);
    alarm.pulse.frequency.setTargetAtTime(hz, context.currentTime, .07);
    alarm.filter.frequency.setTargetAtTime((soft ? 430 : 600) + pressure * 330, context.currentTime, .07);
    alarm.gain.gain.setTargetAtTime(soft ? .065 : .12, context.currentTime, .035);
    alarm.depth.gain.setTargetAtTime(soft ? .055 : .11, context.currentTime, .035);
    diagnostics.alarmActive = true; diagnostics.alarmPulseHz = hz;
  }
  function stopScareTones(): void {
    for (const source of scareTones) { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); }
    scareTones.clear();
    for (const source of scareBuffers) { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); }
    scareBuffers.clear();
  }
  function loop(key: string, name: EffectName, level: number, location: AudioPosition): void {
    if (!context || !master || disposed || !buffers.has(name)) return;
    let current = loops.get(key);
    if (!current && level > 0) {
      const source = context.createBufferSource(); source.buffer = buffers.get(name)!; source.loop = true;
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
    if (movementSource) { try { movementSource.stop(); } catch { /* Ended already. */ } movementSource = null; }
    movementKind = ''; nextStepsAt = 0;
  }
  function playBuffer(buffer: AudioBuffer, gainValue: number, location: AudioPosition = [-1.3, 1.1, -1.8], radio = false): AudioBufferSourceNode | null {
    if (!context || !master || disposed || paused || active.size >= 8) return null;
    const source = context.createBufferSource(); source.buffer = buffer;
    const gain = context.createGain(); gain.gain.value = Math.min(.85, Math.max(0, gainValue));
    const nodes: AudioNode[] = [gain];
    if (radio) {
      const high = context.createBiquadFilter(); high.type = 'highpass'; high.frequency.value = 350;
      const low = context.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 2900;
      source.connect(high); high.connect(low); low.connect(gain); nodes.push(high, low);
    } else source.connect(gain);
    const position = makePanner(location);
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
    const hit = buffer ? playBuffer(buffer, (kind === 'monitor' ? .43 : .58) * (soft ? .42 : 1), location) : null;
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
          const limiter = context.createDynamicsCompressor(); limiter.threshold.value = -12; limiter.knee.value = 8; limiter.ratio.value = 10; limiter.attack.value = .003; limiter.release.value = .18;
          master.connect(limiter); limiter.connect(context.destination);
          context.listener.positionX.value = .05; context.listener.positionY.value = 1.62; context.listener.positionZ.value = .60;
          context.listener.forwardZ.value = -1; context.listener.upY.value = 1;
          await Promise.all(EFFECT_NAMES.map(async name => {
            const response = await fetch(`/assets/audio/${name}.wav`, { signal: loadingController.signal });
            if (!response.ok) throw new Error(`${name} returned ${response.status}`);
            const buffer = await context!.decodeAudioData(await response.arrayBuffer());
            if (!disposed) { buffers.set(name, buffer); diagnostics.loadedEffects.push(name); }
          }));
          if (disposed || !context || !master) return;
          if (paused) await context.suspend(); syncContextState();
          diagnostics.status = 'ready';
        } catch (error) { audioFailure(error); }
      })();
      return startPromise;
    },
    setVolume(value) { volume = Math.min(.7, Math.max(0, value)); if (master && context) master.gain.setTargetAtTime(muted ? 0 : volume, context.currentTime, .04); },
    setMuted(value) { muted = value; if (master && context) master.gain.setTargetAtTime(muted ? 0 : volume, context.currentTime, .04); },
    setPaused(value) {
      paused = value; if (value) { cancelSpeech(); stopAlarm(); stopScareTones(); } if (!context || disposed || context.state === 'closed') return;
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
      // Alarm authority is independent of equipment power: committed late-Q
      // warnings keep sounding only while the core still marks them active.
      updateAlarm(!!state.alarm?.active && !state.paused, state.alarm?.urgency ?? 0, !!state.softScares);
      if (state.time < lastWorldTime) { stopMovement(); nextBreathAt = 0; }
      lastWorldTime = state.time;
      const powered = state.power === 'on' && !state.paused;
      loop('room', 'room_hum', powered ? .46 : 0, [0, 2.8, -.5]);
      for (let i = 0; i < 4; i++) {
        const level = !state.paused && state.faults.includes(i) ? powered ? .23 : state.power === 'blackout' ? .065 : 0 : 0;
        loop(`fault-${i}`, 'fault_rattle', level, [2.42, i < 2 ? .53 : 1.45, .05 + (i % 2 ? .44 : -.44)]);
      }
      loop('remote-lure', 'lure_heartbeat', state.lure?.active && !state.paused ? .58 : 0, state.lure?.position ?? [0, 0, -26]);
      if (paused || state.paused || !context || context.state !== 'running') return;
      const creature = state.creature;
      for (const source of creatureAttached) { const position = positions.get(source); if (position) setPosition(position, creature.position); }
      const motion = creature.distance <= 32 && ['approaching', 'receding'].includes(creature.lastMotion) ? creature.lastMotion : '';
      if (motion !== movementKind) { stopMovement(); movementKind = motion; }
      if (movementSource) { const position = positions.get(movementSource); if (position) setPosition(position, creature.position); }
      if (motion && state.time >= nextStepsAt) {
        const buffer = buffers.get(motion === 'approaching' ? 'steps_approaching' : 'steps_receding');
        if (buffer) movementSource = playBuffer(buffer, .58, creature.position);
        nextStepsAt = state.time + 5;
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
      cancelSpeech(); stopMovement(); stopLoops(); stopAlarm(); stopScareTones(); lastScareAt = -Infinity; queue.reset(); now = 0; lastWorldTime = 0; nextBreathAt = 0; nextScrapeAt = 0; breathSource = null;
      for (const source of active) { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); } active.clear();
      positions.clear(); creatureAttached.clear();
    },
    dispose() {
      if (disposed) return; disposed = true; loadingController.abort(); cancelSpeech(); stopMovement(); stopLoops(); stopAlarm(); stopScareTones(); queue.reset(); speechListeners.clear();
      for (const source of active) { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); } active.clear();
      positions.clear(); creatureAttached.clear(); buffers.clear(); master?.disconnect(); if (context && context.state !== 'closed') void context.close().then(syncContextState).catch(() => undefined);
    },
  };
}
