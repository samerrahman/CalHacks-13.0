import assert from 'node:assert/strict';
import test from 'node:test';
import { captionReadingSeconds, createAudioEngine, EFFECT_NAMES, type AudioWorld, type SpeechEvent } from './engine';

class Parameter { value = 0; automation: number[] = []; setTargetAtTime(value: number) { this.value = value; this.automation.push(value); } setValueAtTime(value: number) { this.value = value; this.automation.push(value); } linearRampToValueAtTime(value: number) { this.value = value; this.automation.push(value); } exponentialRampToValueAtTime(value: number) { this.value = value; this.automation.push(value); } cancelScheduledValues() { /* Mock keeps the recorded automation. */ } }
class Node { connected: Node[] = []; connect(node: Node) { this.connected.push(node); return node; } disconnect() { this.connected = []; } }
class Source extends Node { buffer: { tag: string } | null = null; loop = false; playbackRate = Object.assign(new Parameter(), { value: 1 }); stopped = false; started = false; onended: (() => void) | null = null; start() { this.started = true; } stop() { if (this.stopped) return; this.stopped = true; this.onended?.(); } }
class Oscillator extends Node { type = ''; frequency = new Parameter(); detune = new Parameter(); started = false; stopped = false; stopAt: number | null = null; onended: (() => void) | null = null; start() { this.started = true; } stop(at?: number) { if (at !== undefined && at > FakeContext.current.currentTime) { this.stopAt = at; return; } if (this.stopped) return; this.stopped = true; this.onended?.(); } }
class Panner extends Node { rolloffFactor = 1; positionX = new Parameter(); positionY = new Parameter(); positionZ = new Parameter(); }
class FakeContext {
  static current: FakeContext;
  state = 'suspended'; currentTime = 0; sampleRate = 8000; destination = new Node(); sources: Source[] = []; oscillators: Oscillator[] = []; gains: (Node & { gain: Parameter })[] = []; delays: (Node & { delayTime: Parameter })[] = []; shapers: (Node & { curve: Float32Array | null })[] = [];
  listener = Object.fromEntries(['positionX', 'positionY', 'positionZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ'].map(name => [name, new Parameter()]));
  constructor() { FakeContext.current = this; }
  async resume() { this.state = 'running'; } async suspend() { this.state = 'suspended'; } async close() { this.state = 'closed'; }
  createGain() { const node = Object.assign(new Node(), { gain: new Parameter() }); this.gains.push(node); return node; }
  createDynamicsCompressor() { const node = Object.assign(new Node(), Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map(name => [name, new Parameter()]))) as unknown as Node & { threshold: Parameter }; this.compressors.push(node); return node; }
  compressors: (Node & { threshold: Parameter })[] = [];
  createPanner() { return new Panner(); }
  createWaveShaper() { const node = Object.assign(new Node(), { curve: null as Float32Array | null, oversample: 'none' }); this.shapers.push(node); return node; }
  createDelay() { const node = Object.assign(new Node(), { delayTime: new Parameter() }); this.delays.push(node); return node; }
  createBuffer(_channels: number, length: number) { const data = new Float32Array(length); return { tag: 'noise', getChannelData: () => data }; }
  createBiquadFilter() { return Object.assign(new Node(), { frequency: new Parameter(), Q: new Parameter(), type: '' }); }
  createOscillator() { const source = new Oscillator(); this.oscillators.push(source); return source; }
  createBufferSource() { const source = new Source(); this.sources.push(source); return source; }
  async decodeAudioData(bytes: ArrayBuffer) { return { tag: new TextDecoder().decode(bytes) }; }
}
const world = (extra: Partial<AudioWorld> = {}): AudioWorld => ({ time: 0, power: 'on', faults: [], creature: { position: [0, 0, -20], distance: 20, phase: 'search', lastMotion: 'stationary' }, ...extra });
const pannerOf = (source: Source): Panner => source.connected[0]!.connected[0] as Panner;

test('footsteps carry the threat: louder and quicker as it nears, a run when hunting, direction-only panning', async () => {
  const originalAudio = globalThis.AudioContext, originalFetch = globalThis.fetch, originalRandom = Math.random;
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext; Math.random = () => .5;
  globalThis.fetch = (async input => new Response(String(input).split('/').at(-1))) as typeof fetch;
  const engine = createAudioEngine();
  try {
    await engine.start(); assert.equal(engine.diagnostics.status, 'ready'); assert.equal(engine.diagnostics.loadedEffects.length, EFFECT_NAMES.length); assert.equal(engine.diagnostics.contextState, 'running');
    const context = FakeContext.current, steps = () => context.sources.filter(source => source.buffer?.tag.startsWith('creature_step'));
    engine.setListenerPosition([.2, 1.52, -.4]); assert.deepEqual([context.listener.positionX!.value, context.listener.positionY!.value, context.listener.positionZ!.value], [.2, 1.52, -.4]);
    engine.setListenerPosition([NaN, 9, 9]); assert.equal(context.listener.positionY!.value, 1.52, 'invalid render pose cannot corrupt the audio listener');
    engine.updateWorld(world({ creature: { position: [-12, 0, -16], distance: 20, phase: 'approach', lastMotion: 'approaching' } }));
    const far = engine.diagnostics.lastFootstepGain, first = steps()[0]!; assert.ok(first?.started);
    assert.deepEqual([pannerOf(first).positionX.value, pannerOf(first).positionZ.value], [-12, -16]); assert.equal(pannerOf(first).rolloffFactor, 0, 'loudness comes from the distance curve, not the panner');
    engine.updateWorld(world({ time: .5, creature: { position: [-3.4, 0, .2], distance: 3, phase: 'approach', lastMotion: 'approaching' } }));
    assert.equal(steps().length, 1, 'walking steps keep a cadence');
    engine.updateWorld(world({ time: 1.2, creature: { position: [-3.4, 0, .2], distance: 3, phase: 'approach', lastMotion: 'approaching' } }));
    assert.equal(steps().length, 2); assert.ok(engine.diagnostics.lastFootstepGain > far * 5, 'close footsteps are far louder');
    const before = steps().length;
    const finish = (prefix: string) => context.sources.filter(source => source.buffer?.tag.startsWith(prefix) && !source.stopped).forEach(source => source.stop());
    for (let t = 1.3; t <= 3.3; t += .1) { finish('creature_step'); engine.updateWorld(world({ time: t, hunting: true, creature: { position: [4, 0, -8], distance: 8, phase: 'approach', lastMotion: 'approaching' } })); }
    assert.ok(steps().length - before >= 5, 'a hunt is a run');
    engine.updateWorld(world({ time: 4, power: 'quiet', creature: { position: [-3.4, 0, .2], distance: 3.4, phase: 'listen', lastMotion: 'stationary' } }));
    const breath = context.sources.find(source => source.buffer?.tag === 'wall_breath.wav')!; assert.ok(breath?.started);
    engine.updateWorld(world({ time: 5, power: 'quiet', creature: { position: [-12, 0, -12], distance: 17, phase: 'listen', lastMotion: 'stationary' } }));
    assert.ok(breath.stopped); assert.equal(context.sources.filter(source => source.buffer?.tag === 'wall_breath.wav').length, 1, 'distant listening never emits a near-wall breath');
    engine.updateWorld(world({ time: 30, creature: { position: [0, 0, -40], distance: 23, phase: 'search', lastMotion: 'stationary' } }));
    assert.equal(steps().filter(source => !source.stopped).length >= 0, true); const outOfRange = steps().length;
    engine.updateWorld(world({ time: 40, creature: { position: [0, 0, -40], distance: 23, phase: 'search', lastMotion: 'stationary' } }));
    assert.equal(steps().length, outOfRange, 'beyond hearing range there are no footsteps');
    engine.reset(); assert.ok(context.sources.every(source => source.stopped), 'reset stops all old effects and beds');
    assert.equal(engine.diagnostics.decodedSpeech, 0); assert.equal(engine.diagnostics.startedSpeech, 0);
    engine.speak({ id: 'playback-proof', text: 'The transmitter is ready.', expiresAt: 30, priority: 1, source: 'live', audioBase64: btoa('speech-proof') });
    engine.update(0); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(engine.diagnostics.decodedSpeech, 1); assert.equal(engine.diagnostics.startedSpeech, 1); assert.equal(engine.diagnostics.playbackErrors, 0);
    assert.ok(context.sources.some(source => source.buffer?.tag === 'speech-proof' && source.started));
  } finally { engine.dispose(); globalThis.AudioContext = originalAudio; globalThis.fetch = originalFetch; Math.random = originalRandom; }
});
test('fault beds power down in quiet and the sustained lure uses its remote emitter', async () => {
  const originalAudio = globalThis.AudioContext, originalFetch = globalThis.fetch;
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
  globalThis.fetch = (async input => new Response(String(input).split('/').at(-1))) as typeof fetch;
  const engine = createAudioEngine();
  try {
    await engine.start(); const context = FakeContext.current;
    engine.updateWorld(world({ faults: [1], lure: { active: true, position: [-16, 0, -34] } }));
    const faults = context.sources.filter(source => source.loop && pannerOf(source).positionX.value === 2.42); assert.equal(faults.length, 1, 'one fault sound from its rack slot'); assert.ok(faults[0]!.loop);
    const lure = context.sources.find(source => source.buffer?.tag === 'lure_heartbeat.wav')!;
    assert.deepEqual([pannerOf(lure).positionX.value, pannerOf(lure).positionZ.value], [-16, -34]);
    const faultGain = faults[0]!.connected[0] as Node & { gain: Parameter }; assert.ok(faultGain.gain.value > 0);
    engine.updateWorld(world({ time: 1, power: 'quiet', faults: [1] })); assert.equal(faultGain.gain.value, 0);
    const lureGain = lure.connected[0] as Node & { gain: Parameter }; assert.equal(lureGain.gain.value, 0);
  } finally { engine.dispose(); globalThis.AudioContext = originalAudio; globalThis.fetch = originalFetch; }
});

test('it pounds on the wall when it is there, a barrage once committed; crickets fall silent near it; the night adds one-shots', async () => {
  const originalAudio = globalThis.AudioContext, originalFetch = globalThis.fetch, originalRandom = Math.random;
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext; Math.random = () => .5;
  globalThis.fetch = (async input => new Response(String(input).split('/').at(-1))) as typeof fetch;
  const engine = createAudioEngine();
  try {
    await engine.start(); const context = FakeContext.current;
    const crickets = () => (context.sources.find(source => source.buffer?.tag === 'ambience_crickets.wav')!.connected[0] as Node & { gain: Parameter }).gain.value;
    engine.updateWorld(world({ creature: { position: [0, 0, -40], distance: 20, phase: 'search', lastMotion: 'stationary' } }));
    assert.ok(crickets() > 0, 'crickets sing while it is far'); assert.ok(context.sources.some(source => source.buffer?.tag === 'ambience_wind.wav' && source.loop));
    engine.updateWorld(world({ time: 1, creature: { position: [0, 0, -4], distance: 1, phase: 'listen', lastMotion: 'stationary' } }));
    assert.equal(crickets(), 0, 'crickets fall silent when it is near');
    assert.equal(engine.diagnostics.wallPounds, 1); const pound = context.sources.find(source => source.buffer?.tag.startsWith('wall_pound'))!;
    assert.ok(Math.abs(Math.hypot(pannerOf(pound).positionX.value, pannerOf(pound).positionZ.value) - 3.3) < 1e-6, 'pounding comes from the hull');
    engine.updateWorld(world({ time: 2, creature: { position: [0, 0, -4], distance: 1, phase: 'listen', lastMotion: 'stationary' } }));
    assert.equal(engine.diagnostics.wallPounds, 1, 'a waiting creature pounds now and then, not constantly');
    for (let t = 2.1; t <= 4.1; t += .1) { context.sources.filter(source => source.buffer?.tag.startsWith('wall_pound') && !source.stopped).forEach(source => source.stop()); engine.updateWorld(world({ time: t, creature: { position: [0, 0, -3.5], distance: 1, phase: 'breach', lastMotion: 'stationary' } })); }
    assert.ok(engine.diagnostics.wallPounds >= 4, 'a committed attack is a rapid barrage');
    const shots = engine.diagnostics.ambientOneShots;
    for (let t = 5; t <= 40; t += .5) { context.sources.filter(source => !source.loop && !source.stopped).forEach(source => source.stop()); engine.updateWorld(world({ time: t, creature: { position: [0, 0, -40], distance: 20, phase: 'search', lastMotion: 'stationary' } })); }
    assert.ok(engine.diagnostics.ambientOneShots > shots, 'random night sounds play');
    engine.setPaused(true); engine.updateWorld(world({ time: 41, paused: true }));
    assert.equal(crickets(), 0, 'pause silences the beds');
    engine.reset(); assert.ok(context.sources.every(source => source.stopped));
  } finally { engine.dispose(); globalThis.AudioContext = originalAudio; globalThis.fetch = originalFetch; Math.random = originalRandom; }
});
test('mechanical scares have short envelopes, positional routing, softer gain and bounded retriggering', async () => {
 const originalAudio = globalThis.AudioContext, originalFetch = globalThis.fetch;
 globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
 globalThis.fetch = (async input => new Response(String(input).split('/').at(-1))) as typeof fetch;
 const engine = createAudioEngine();
 try {
  await engine.start(); const context = FakeContext.current;
  engine.playScare('breach', [1, 1.5, -2]);
  assert.equal(engine.diagnostics.startedScares, 1);
  const first = context.oscillators[0]!; const firstEnvelope = first.connected[0]!.connected[0] as Node & { gain: Parameter };
  const firstPanner = firstEnvelope.connected[0] as Panner;
  assert.deepEqual([firstPanner.positionX.value, firstPanner.positionY.value, firstPanner.positionZ.value], [1, 1.5, -2]);
  assert.equal(firstPanner.connected[0], context.gains[0]);
  assert.ok(first.stopAt! <= .55); assert.equal(Math.max(...firstEnvelope.gain.automation), .28);
  assert.ok(context.sources.some(s => s.buffer?.tag === 'breach_impact.wav' && s.started));
  engine.playScare('breach'); assert.equal(engine.diagnostics.startedScares, 1, 'repeated frames cannot stack impacts');
  const scream = context.oscillators.slice(1), limiter = context.compressors[0]!;
  assert.ok(scream.filter(o => o.type === 'sawtooth').length >= 4 && scream.every(o => o.started && o.stopAt! <= 3.5), 'breach adds a bounded scream voice and growl');
  assert.ok(context.sources.some(s => s.buffer?.tag === 'noise' && s.started), 'breach adds rasp noise');
  assert.equal(Math.max(...limiter.threshold.automation), -1, 'unsoftened breach briefly opens the limiter');
  const scareBus = context.gains.find(g => g !== context.gains[0] && g.connected.some(n => 'curve' in n && n.connected.includes(limiter)))!; assert.ok(scareBus, 'the scream has its own clipped bus into the limiter');
  assert.equal(scareBus.gain.value, Math.min(1.6, .55 * 3.2));
  assert.equal(context.sources.filter(s => s.buffer?.tag === 'creature_scream.wav').length, 2, 'two recorded screams layer in'); engine.setMuted(true); assert.equal(scareBus.gain.value, 0, 'mute silences the scream'); engine.setMuted(false);
  context.currentTime = 1; const before = context.oscillators.length; const openings = limiter.threshold.automation.filter(v => v === -1).length;
  engine.playScare('breach', undefined, true);
  const softer = context.oscillators[before]!;
  assert.equal(limiter.threshold.automation.filter(v => v === -1).length, openings, 'softer scares keep the normal limiter'); const softEnvelope = softer.connected[0]!.connected[0] as Node & { gain: Parameter };
  assert.ok(Math.max(...softEnvelope.gain.automation) < Math.max(...firstEnvelope.gain.automation));
  engine.setPaused(true); assert.ok(softer.stopped); context.currentTime = 3; engine.playScare('monitor'); assert.equal(engine.diagnostics.startedScares, 2);
  assert.ok(context.sources.filter(s => s.buffer?.tag === 'breach_impact.wav').every(s => s.stopped), 'pause stops the mechanical sample layers too');
  assert.ok(scream.every(o => o.stopped), 'pause stops the scream layers');
  engine.reset(); assert.ok(context.oscillators.every(o => o.stopped));
  assert.equal(limiter.threshold.value, -12, 'stopping a scare restores the limiter');
 } finally { engine.dispose(); globalThis.AudioContext = originalAudio; globalThis.fetch = originalFetch; }
});

test('creature speech waits for actual instruction completion while alarm and scare effects remain immediate', async () => {
  const originalAudio = globalThis.AudioContext, originalFetch = globalThis.fetch;
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
  globalThis.fetch = (async input => new Response(String(input).split('/').at(-1))) as typeof fetch;
  const engine = createAudioEngine(), events: SpeechEvent[] = [];
  engine.subscribeSpeech(event => events.push(event));
  try {
    await engine.start(); const context = FakeContext.current;
    engine.speak({ id: 'opening', text: 'Eight faults. Isolate when you hear the alarm.', expiresAt: 2, priority: 3, source: 'live', audioBase64: btoa('opening audio') });
    assert.equal(events.length, 0, 'requesting speech does not display a caption');
    engine.update(0); await new Promise(resolve => setTimeout(resolve, 0));
    const opening = context.sources.find(source => source.buffer?.tag === 'opening audio')!;
    assert.deepEqual(events, [{ type: 'started', id: 'opening', text: 'Eight faults. Isolate when you hear the alarm.', mode: 'live' }]);
    engine.speak({ id: 'creature', text: 'I can hear you working.', expiresAt: 12, priority: 4, source: 'cached', audioBase64: btoa('creature audio') });
    engine.update(3); await Promise.resolve();
    assert.equal(opening.stopped, false, 'higher priority and latest-start expiry cannot truncate begun speech');
    assert.equal(context.sources.filter(source => source.buffer?.tag === 'creature audio').length, 0);
    engine.updateWorld(world({ time: 3, creature: { position: [0, 0, -6], distance: 4, phase: 'approach', lastMotion: 'approaching' } })); engine.playScare('impact');
    assert.ok(engine.diagnostics.footsteps >= 1); assert.equal(engine.diagnostics.startedScares, 1);
    assert.equal(opening.stopped, false, 'critical effects do not steal the speech slot');
    opening.onended?.();
    assert.equal(events.at(-1)?.type, 'ended', 'pending speech keeps the engine busy between lines');
    engine.update(3.1); await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(events.at(-1), { type: 'started', id: 'creature', text: 'I can hear you working.', mode: 'cached' });
    context.sources.find(source => source.buffer?.tag === 'creature audio')!.onended?.();
    assert.deepEqual(events.slice(-2), [{ type: 'ended', id: 'creature' }, { type: 'idle' }]);
    assert.equal(engine.isSpeechBusy(), false);
  } finally { engine.dispose(); globalThis.AudioContext = originalAudio; globalThis.fetch = originalFetch; }
});

test('creature speech gets the dark distortion while human radio speech keeps its original treatment', async () => {
  const originalAudio = globalThis.AudioContext, originalFetch = globalThis.fetch;
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
  globalThis.fetch = (async input => new Response(String(input).split('/').at(-1))) as typeof fetch;
  const engine = createAudioEngine();
  try {
    await engine.start(); const context = FakeContext.current;
    engine.speak({ id: 'creature', text: 'I heard you.', expiresAt: 20, priority: 3, audioBase64: btoa('creature voice'), followCreature: true, position: [2, 1, -5] });
    engine.update(0); await new Promise(resolve => setTimeout(resolve, 0));
    const creature = context.sources.find(source => source.buffer?.tag === 'creature voice')!;
    assert.equal(creature.playbackRate.value, .78);
    assert.equal(context.delays.length, 1); assert.equal(context.delays[0]!.delayTime.value, .085);
    assert.ok(context.shapers.some(shaper => shaper.curve?.length === 1024));
    assert.ok(creature.started);
    engine.cancelSpeech('creature'); assert.ok(creature.stopped);
    engine.speak({ id: 'radio', text: 'Stay inside.', expiresAt: 20, priority: 3, audioBase64: btoa('human voice') });
    engine.update(1); await new Promise(resolve => setTimeout(resolve, 0));
    const radio = context.sources.find(source => source.buffer?.tag === 'human voice')!;
    assert.equal(radio.playbackRate.value, 1); assert.equal(context.delays.length, 1);
  } finally { engine.dispose(); globalThis.AudioContext = originalAudio; globalThis.fetch = originalFetch; }
});

test('caption fallback reserves readable time even without an audio context', () => {
  const engine = createAudioEngine(), events: SpeechEvent[] = [];
  engine.subscribeSpeech(event => events.push(event));
  const text = 'Eight faults. Work at the terminal. Isolate the machines when you hear the proximity alarm. Do not wait for it to reach the wall.';
  engine.speak({ id: 'caption', text, priority: 3, expiresAt: 1 }); engine.update(0);
  assert.deepEqual(events, [{ type: 'started', id: 'caption', text, mode: 'caption' }]);
  assert.equal(engine.isSpeechBusy(), true);
  engine.update(captionReadingSeconds(text) - .01); assert.equal(engine.isSpeechBusy(), true);
  engine.update(captionReadingSeconds(text));
  assert.equal(engine.isSpeechBusy(), false);
  assert.deepEqual(events.slice(-2), [{ type: 'ended', id: 'caption' }, { type: 'idle' }]);
  engine.dispose();
});

test('pause cancels speech once, clears its caption lifecycle and never resumes obsolete audio', async () => {
  const originalAudio = globalThis.AudioContext, originalFetch = globalThis.fetch;
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
  globalThis.fetch = (async input => new Response(String(input).split('/').at(-1))) as typeof fetch;
  const engine = createAudioEngine(), events: SpeechEvent[] = [];
  engine.subscribeSpeech(event => events.push(event));
  try {
    await engine.start(); engine.speak({ id: 'paused', text: 'Eight faults.', expiresAt: 20, priority: 3, audioBase64: btoa('paused audio') });
    engine.update(0); await new Promise(resolve => setTimeout(resolve, 0));
    const source = FakeContext.current.sources.find(item => item.buffer?.tag === 'paused audio')!;
    engine.setPaused(true); assert.equal(source.stopped, true); assert.equal(engine.isSpeechBusy(), false);
    assert.equal(engine.speak({ id: 'late while paused', text: 'Obsolete.', expiresAt: 20, priority: 4 }), false);
    assert.equal(events.filter(event => event.type === 'cancelled').length, 1);
    assert.equal(events.filter(event => event.type === 'ended').length, 0, 'source.stop is cancellation, not natural completion');
    engine.setPaused(false); await Promise.resolve(); engine.update(1);
    assert.equal(engine.diagnostics.startedSpeech, 1);
  } finally { engine.dispose(); globalThis.AudioContext = originalAudio; globalThis.fetch = originalFetch; }
});

test('a decoder completing after stage cancellation cannot emit a premature caption or play stale speech', async () => {
  const originalAudio = globalThis.AudioContext, originalFetch = globalThis.fetch;
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
  globalThis.fetch = (async input => new Response(String(input).split('/').at(-1))) as typeof fetch;
  const engine = createAudioEngine(), events: SpeechEvent[] = [];
  engine.subscribeSpeech(event => events.push(event));
  try {
    await engine.start();
    let finishDecode!: (value: { tag: string }) => void;
    FakeContext.current.decodeAudioData = () => new Promise(resolve => { finishDecode = resolve; });
    engine.speak({ id: 'decoding', text: 'Prepare emitter A.', expiresAt: 20, priority: 3, audioBase64: btoa('stale') });
    engine.update(0); assert.equal(engine.isSpeechBusy(), true); assert.equal(events.length, 0);
    engine.update(1, () => false); finishDecode({ tag: 'stale' }); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(events.some(event => event.type === 'started'), false);
    assert.equal(events.filter(event => event.type === 'cancelled').length, 1);
    assert.equal(engine.diagnostics.startedSpeech, 0); assert.equal(engine.isSpeechBusy(), false);
  } finally { engine.dispose(); globalThis.AudioContext = originalAudio; globalThis.fetch = originalFetch; }
});
