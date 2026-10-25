import test from 'node:test';
import assert from 'node:assert/strict';
import { iceBatches, parseIce, SIGNAL, spend, validPayload, validSdp, type IceInit } from '../src/signalRules';

const sdp = (extra = '') => `v=0\r\no=- 46117 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\na=sendonly\r\n${extra}`;
const cand = (n: number): IceInit => ({ candidate: `candidate:${n} 1 udp 2122260223 192.0.2.${n % 250} ${50000 + n} typ host generation 0`, sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'Ab3x' });

test('offers and answers must be bounded ASCII SDP with a video section', () => {
  assert.equal(validSdp(sdp()), true);
  assert.equal(validPayload('offer', sdp()), true);
  assert.equal(validPayload('answer', sdp()), true);
  assert.equal(validSdp(sdp().replace('m=video', 'm=audio')), false, 'no video section');
  assert.equal(validSdp('o=- 1 2 IN IP4 0.0.0.0\r\nm=video 9 X 96\r\n'), false, 'must start with v=0');
  assert.equal(validSdp(sdp('a=x:\u0000\r\n')), false, 'control bytes');
  assert.equal(validSdp(sdp('a=x:é\r\n')), false, 'non-ASCII');
  assert.equal(validSdp(sdp(`a=x:${'y'.repeat(SIGNAL.MAX_PAYLOAD)}\r\n`)), false, 'over the 8 KB cap');
  assert.equal(validSdp({ type: 'offer', sdp: sdp() }), false, 'payload is the raw SDP string, not an object');
});

test('ICE batches are strict: known fields, sane values, bounded count', () => {
  assert.deepEqual(parseIce(JSON.stringify([cand(1)])), [cand(1)]);
  assert.deepEqual(parseIce(JSON.stringify([{ ...cand(2), usernameFragment: null }])), [{ candidate: cand(2).candidate, sdpMid: '0', sdpMLineIndex: 0 }]);
  assert.equal(parseIce('[]'), null, 'empty');
  assert.equal(parseIce('{"candidate":"candidate:1"}'), null, 'not an array');
  assert.equal(parseIce('not json'), null);
  assert.equal(parseIce(JSON.stringify([{ ...cand(1), extra: 1 }])), null, 'unknown field');
  assert.equal(parseIce(JSON.stringify([{ ...cand(1), candidate: 'a=candidate:1' }])), null, 'wrong prefix');
  assert.equal(parseIce(JSON.stringify([{ ...cand(1), candidate: '' }])), null, 'end-of-candidates is never sent');
  assert.equal(parseIce(JSON.stringify([{ ...cand(1), sdpMLineIndex: 99 }])), null, 'mline out of range');
  assert.equal(parseIce(JSON.stringify([{ ...cand(1), sdpMid: null, sdpMLineIndex: null }])), null, 'needs a mid or index');
  assert.equal(parseIce(JSON.stringify([{ ...cand(1), sdpMid: '<script>' }])), null);
  assert.equal(parseIce(JSON.stringify(Array.from({ length: SIGNAL.MAX_ICE_BATCH + 1 }, (_, i) => cand(i)))), null, 'too many in one message');
});

test('each kind only accepts its own payload', () => {
  assert.equal(validPayload('bye', 'full'), true);
  assert.equal(validPayload('bye', 'closed'), true);
  assert.equal(validPayload('bye', 'anything else'), false);
  assert.equal(validPayload('join', ''), true);
  assert.equal(validPayload('join', 'x'), false);
  assert.equal(validPayload('leave', ''), true);
  assert.equal(validPayload('ice', sdp()), false);
  assert.equal(validPayload('offer', JSON.stringify([cand(1)])), false);
  assert.equal(validPayload('frame', 'data:image/jpeg;base64,AAAA'), false, 'no other kinds, so no frames');
  assert.equal(validPayload('offer', 42 as unknown as string), false);
});

test('fixed windows allow exactly the limit, then reset after the window', () => {
  let w: { windowStartMs: bigint; windowCount: number } | null = { windowStartMs: 1000n, windowCount: 0 };
  let accepted = 0;
  for (let i = 0; i < SIGNAL.PEER_MAX + 5; i++) { const next = spend(w!, 1000n + BigInt(i), SIGNAL.PEER_MAX); if (next) { w = next; accepted++; } }
  assert.equal(accepted, SIGNAL.PEER_MAX);
  assert.equal(spend(w!, 1000n + BigInt(SIGNAL.WINDOW_MS) - 1n, SIGNAL.PEER_MAX), null, 'still the same window');
  assert.deepEqual(spend(w!, 1000n + BigInt(SIGNAL.WINDOW_MS), SIGNAL.PEER_MAX), { windowStartMs: 1000n + BigInt(SIGNAL.WINDOW_MS), windowCount: 1 });
  assert.deepEqual(spend({ windowStartMs: 5000n, windowCount: 99 }, 4000n, 10), { windowStartMs: 4000n, windowCount: 1 }, 'a clock step backwards restarts the window');
  assert.ok(SIGNAL.SESSION_MAX >= SIGNAL.PEER_MAX * 2 && SIGNAL.SESSION_MAX < SIGNAL.PEER_MAX * SIGNAL.MAX_PEERS, 'the session cap binds before every peer can max out');
});

test('outgoing ICE is split into valid batches under both caps', () => {
  const many = Array.from({ length: 40 }, (_, i) => cand(i));
  const batches = iceBatches(many);
  assert.equal(batches.length, Math.ceil(40 / SIGNAL.MAX_ICE_BATCH));
  assert.ok(batches.every(b => b.length <= SIGNAL.MAX_PAYLOAD && parseIce(b)));
  assert.equal(batches.flatMap(b => parseIce(b)!).length, 40);
  assert.deepEqual(iceBatches([{ ...cand(1), candidate: 'bogus' }, cand(2)]).flatMap(b => parseIce(b)!), [cand(2)], 'invalid local candidates are dropped, not sent');
  const long = Array.from({ length: 16 }, (_, i) => ({ ...cand(i), candidate: `candidate:${i} 1 udp 1 ${'a'.repeat(470)} 1 typ host` }));
  const split = iceBatches(long);
  assert.equal(split.length, 2, 'size cap splits long candidates');
  assert.ok(split.every(b => b.length <= SIGNAL.MAX_PAYLOAD && parseIce(b)));
  assert.equal(split.flatMap(b => parseIce(b)!).length, 16);
});
