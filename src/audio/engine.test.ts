import assert from 'node:assert/strict';
import test from 'node:test';
import { captionReadingSeconds, createAudioEngine, type AudioWorld, type SpeechEvent } from './engine';

class Parameter { value = 0; automation: number[] = []; setTargetAtTime(value: number) { this.value = value; this.automation.push(value); } setValueAtTime(value: number) { this.value = value; this.automation.push(value); } linearRampToValueAtTime(value: number) { this.value = value; this.automation.push(value); } exponentialRampToValueAtTime(value: number) { this.value = value; this.automation.push(value); } cancelScheduledValues() { /* Mock keeps the recorded automation. */ } }
class Node { connected: Node[] = []; connect(node: Node) { this.connected.push(node); return node; } disconnect() { this.connected = []; } }
class Source extends Node { buffer: { tag: string } | null = null; loop = false; stopped = false; started = false; onended: (() => void) | null = null; start() { this.started = true; } stop() { if (this.stopped) return; this.stopped = true; this.onended?.(); } }
class Oscillator extends Node { type = ''; frequency = new Parameter(); detune = new Parameter(); started = false; stopped = false; stopAt: number | null = null; onended: (() => void) | null = null; start() { this.started = true; } stop(at?: number) { if (at !== undefined && at > FakeContext.current.currentTime) { this.stopAt = at; return; } if (this.stopped) return; this.stopped = true; this.onended?.(); } }
class Panner extends Node { positionX = new Parameter(); positionY = new Parameter(); positionZ = new Parameter(); }
class FakeContext {
  static current: FakeContext;
  state = 'suspended'; currentTime = 0; sampleRate = 8000; destination = new Node(); sources: Source[] = []; oscillators: Oscillator[] = []; gains: (Node & { gain: Parameter })[] = [];
  listener = Object.fromEntries(['positionX', 'positionY', 'positionZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ'].map(name => [name, new Parameter()]));
  constructor() { FakeContext.current = this; }
  async resume() { this.state = 'running'; } async suspend() { this.state = 'suspended'; } async close() { this.state = 'closed'; }
  createGain() { const node = Object.assign(new Node(), { gain: new Parameter() }); this.gains.push(node); return node; }
  createDynamicsCompressor() { const node = Object.assign(new Node(), Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map(name => [name, new Parameter()]))) as unknown as Node & { threshold: Parameter }; this.compressors.push(node); return node; }
  compressors: (Node & { threshold: Parameter })[] = [];
  createPanner() { return new Panner(); }
  createWaveShaper() { return Object.assign(new Node(), { curve: null as Float32Array | null, oversample: 'none' }); }
  createBuffer(_channels: number, length: number) { const data = new Float32Array(length); return { tag: 'noise', getChannelData: () => data }; }
  createBiquadFilter() { return Object.assign(new Node(), { frequency: new Parameter(), Q: new Parameter(), type: '' }); }
  createOscillator() { const source = new Oscillator(); this.oscillators.push(source); return source; }
  createBufferSource() { const source = new Source(); this.sources.push(source); return source; }
  async decodeAudioData(bytes: ArrayBuffer) { return { tag: new TextDecoder().decode(bytes) }; }
}
const world = (extra: Partial<AudioWorld> = {}): AudioWorld => ({ time: 0, power: 'on', faults: [], creature: { position: [0, 0, -20], distance: 20, phase: 'search', lastMotion: 'stationary' }, ...extra });
const pannerOf = (source: Source): Panner => source.connected[0]!.connected[0] as Panner;

test('world audio follows the same creature position and stops contradictory movement/breath cues', async () => {
  const originalAudio = globalThis.AudioContext, originalFetch = globalThis.fetch;
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
  globalThis.fetch = (async input => new Response(String(input).split('/').at(-1))) as typeof fetch;
  const engine = createAudioEngine();
  try {
    await engine.start(); assert.equal(engine.diagnostics.status, 'ready'); assert.equal(engine.diagnostics.loadedEffects.length, 27); assert.equal(engine.diagnostics.contextState, 'running');
    const context = FakeContext.current;
    engine.setListenerPosition([.2, 1.52, -.4]); assert.deepEqual([context.listener.positionX!.value, context.listener.positionY!.value, context.listener.positionZ!.value], [.2, 1.52, -.4]);
    engine.setListenerPosition([NaN, 9, 9]); assert.equal(context.listener.positionY!.value, 1.52, 'invalid render pose cannot corrupt the audio listener');
    engine.updateWorld(world({ creature: { position: [-3.8, 0, 0], distance: 3.8, phase: 'approach', lastMotion: 'approaching' } }));
    const approach = context.sources.find(source => source.buffer?.tag === 'steps_approaching.wav')!; assert.ok(approach?.started);
    assert.deepEqual([pannerOf(approach).positionX.value, pannerOf(approach).positionY.value, pannerOf(approach).positionZ.value], [-3.8, 0, 0]);
    engine.updateWorld(world({ time: 1, creature: { position: [-3.4, 0, .2], distance: 3.4, phase: 'approach', lastMotion: 'approaching' } }));
    assert.equal(pannerOf(approach).positionZ.value, .2, 'active footsteps follow simulation position');
    engine.updateWorld(world({ time: 2, power: 'quiet', creature: { position: [-3.4, 0, .2], distance: 3.4, phase: 'listen', lastMotion: 'stationary' } }));
    assert.ok(approach.stopped); const breath = context.sources.find(source => source.buffer?.tag === 'wall_breath.wav')!; assert.ok(breath?.started);
    engine.updateWorld(world({ time: 3, power: 'quiet', creature: { position: [-12, 0, -12], distance: 17, phase: 'retreat', lastMotion: 'receding' } }));
    assert.ok(breath.stopped); const receding = context.sources.find(source => source.buffer?.tag === 'steps_receding.wav')!; assert.ok(receding?.started);
    assert.equal(pannerOf(receding).positionX.value, -12);
    engine.updateWorld(world({ time: 4, power: 'quiet', creature: { position: [-12, 0, -12], distance: 17, phase: 'listen', lastMotion: 'stationary' } }));
    assert.ok(receding.stopped); assert.equal(context.sources.filter(source => source.buffer?.tag === 'wall_breath.wav').length, 1, 'distant listening never emits a near-wall breath');
    engine.reset(); assert.ok(context.sources.every(source => source.stopped), 'reset stops all old effects and beds');
    assert.equal(engine.diagnostics.decodedSpeech, 0); assert.equal(engine.diagnostics.startedSpeech, 0);
    engine.speak({ id: 'playback-proof', text: 'The transmitter is ready.', expiresAt: 30, priority: 1, source: 'live', audioBase64: btoa('speech-proof') });
    engine.update(0); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(engine.diagnostics.decodedSpeech, 1); assert.equal(engine.diagnostics.startedSpeech, 1); assert.equal(engine.diagnostics.playbackErrors, 0);
    assert.ok(context.sources.some(source => source.buffer?.tag === 'speech-proof' && source.started));
  } finally { engine.dispose(); globalThis.AudioContext = originalAudio; globalThis.fetch = originalFetch; }
});

test('fault beds power down in quiet and the sustained lure uses its remote emitter', async () => {
  const originalAudio = globalThis.AudioContext, originalFetch = globalThis.fetch;
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
  globalThis.fetch = (async input => new Response(String(input).split('/').at(-1))) as typeof fetch;
  const engine = createAudioEngine();
  try {
    await engine.start(); const context = FakeContext.current;
    engine.updateWorld(world({ faults: [1], lure: { active: true, position: [-16, 0, -34] } }));
    const faults = context.sources.filter(source => source.buffer?.tag === 'fault_rattle.wav'); assert.equal(faults.length, 1); assert.ok(faults[0]!.loop);
    const lure = context.sources.find(source => source.buffer?.tag === 'lure_heartbeat.wav')!;
    assert.deepEqual([pannerOf(lure).positionX.value, pannerOf(lure).positionZ.value], [-16, -34]);
    const faultGain = faults[0]!.connected[0] as Node & { gain: Parameter }; assert.ok(faultGain.gain.value > 0);
    engine.updateWorld(world({ time: 1, power: 'quiet', faults: [1] })); assert.equal(faultGain.gain.value, 0);
    const lureGain = lure.connected[0] as Node & { gain: Parameter }; assert.equal(lureGain.gain.value, 0);
  } finally { engine.dispose(); globalThis.AudioContext = originalAudio; globalThis.fetch = originalFetch; }
});

test('siren shares the bounded bus, sweeps faster with urgency and never duplicates its graph', async () => {
 const originalAudio = globalThis.AudioContext, originalFetch = globalThis.fetch;
 globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
 globalThis.fetch = (async input => new Response(String(input).split('/').at(-1))) as typeof fetch;
 const engine = createAudioEngine();
 try {
  await engine.start(); const context = FakeContext.current;
  engine.updateWorld(world({ alarm: { active: false, urgency: 1 } })); assert.equal(context.oscillators.length, 0);
  engine.updateWorld(world({ alarm: { active: true, urgency: 0 } }));
  assert.equal(context.oscillators.length, 3); assert.ok(context.oscillators.every(o => o.started));
  const slow = engine.diagnostics.alarmPulseHz; assert.equal(slow, .5, 'a slow wail when it first gets close');
  const master = context.gains[0]!;
  const horn = context.oscillators[0]!;
  const filter = horn.connected[0]!.connected[0]!;
  const envelope = filter.connected[0] as Node & { gain: Parameter };
  assert.equal(envelope.connected[0]!.connected[0], master, 'alarm panner routes through shared master/limiter');
  for (let i = 0; i < 120; i++) engine.updateWorld(world({ time: i / 60, power: 'quiet', alarm: { active: true, urgency: i / 119 } }));
  assert.equal(context.oscillators.length, 3, 'render updates reuse the same three oscillators');
  assert.ok(engine.diagnostics.alarmPulseHz > slow); assert.equal(engine.diagnostics.alarmPulseHz, 5, 'a fast yelp at the wall');
  engine.updateWorld(world({ alarm: { active: true, urgency: .33 } })); assert.ok(engine.diagnostics.alarmPulseHz > .5 + 4.5 * .5, 'a third of the urgency is already past half speed');
  assert.ok(engine.diagnostics.alarmActive, 'committed late-Q alarm survives equipment isolation');
  engine.updateWorld(world({ power: 'blackout', alarm: { active: true, urgency: 2 }, softScares: true }));
  assert.equal(engine.diagnostics.alarmPulseHz, 5); assert.equal(envelope.gain.value, .06);
  engine.setMuted(true); assert.equal(master.gain.value, 0); engine.setVolume(.7); assert.equal(master.gain.value, 0);
  engine.setMuted(false); assert.equal(master.gain.value, .7);
  engine.updateWorld(world({ alarm: { active: false, urgency: 1 } }));
  assert.ok(context.oscillators.every(o => o.stopped)); assert.equal(engine.diagnostics.alarmActive, false);
 } finally { engine.dispose(); globalThis.AudioContext = originalAudio; globalThis.fetch = originalFetch; }
});

test('pause, ended-world state, reset and disposal tear down alarm sources immediately', async () => {
 const originalAudio = globalThis.AudioContext, originalFetch = globalThis.fetch;
 globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
 globalThis.fetch = (async input => new Response(String(input).split('/').at(-1))) as typeof fetch;
 const engine = createAudioEngine();
 try {
  await engine.start(); const context = FakeContext.current;
  const alarming = world({ alarm: { active: true, urgency: .5 } });
  engine.updateWorld(alarming); engine.setPaused(true);
  assert.ok(context.oscillators.every(o => o.stopped)); assert.equal(engine.diagnostics.alarmActive, false);
  engine.updateWorld(alarming); assert.equal(context.oscillators.length, 3, 'paused engine cannot resurrect a siren');
  engine.setPaused(false); await Promise.resolve(); engine.updateWorld(alarming); assert.equal(context.oscillators.length, 6);
  engine.updateWorld({ ...alarming, paused: true }); assert.ok(context.oscillators.every(o => o.stopped));
  engine.updateWorld(alarming); engine.reset(); assert.ok(context.oscillators.every(o => o.stopped));
  engine.updateWorld(alarming); engine.dispose(); assert.ok(context.oscillators.every(o => o.stopped));
  assert.equal(engine.diagnostics.alarmActive, false);
 } finally { engine.dispose(); globalThis.AudioContext = originalAudio; globalThis.fetch = originalFetch; }
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
  assert.ok(scream.filter(o => o.type === 'sawtooth').length >= 4 && scream.every(o => o.started && o.stopAt! <= 2.1), 'breach adds a bounded scream voice and growl');
  assert.ok(context.sources.some(s => s.buffer?.tag === 'noise' && s.started), 'breach adds rasp noise');
  assert.equal(Math.max(...limiter.threshold.automation), -1, 'unsoftened breach briefly opens the limiter');
  const scareBus = context.gains.find(g => g !== context.gains[0] && g.connected.includes(limiter))!; assert.ok(scareBus, 'the scream has its own bus into the limiter');
  assert.equal(scareBus.gain.value, Math.min(1, .55 * 1.9)); engine.setMuted(true); assert.equal(scareBus.gain.value, 0, 'mute silences the scream'); engine.setMuted(false);
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
    engine.updateWorld(world({ time: 3, alarm: { active: true, urgency: .5 } })); engine.playScare('impact');
    assert.equal(engine.diagnostics.alarmActive, true); assert.equal(engine.diagnostics.startedScares, 1);
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
