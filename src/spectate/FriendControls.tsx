import { useEffect, useRef, useState } from 'react';
import { config } from '../game/config';
import { dispatch, step } from '../game/reducer';
import { challengeSolved, newChallenge, type Challenge } from './challenge';
import type { GameAction, GameState } from '../game/state';
import type { TraceSnapshot } from '../integrations/client';
import type { CoopManualFeed } from '../integrations/coop';
import { ConduitTask } from '../ui/ThinkingTasks';

type Sent = 'remote' | 'local' | 'refused' | 'failed';
const SENT: Record<Sent, string> = { remote: 'Sent', local: 'Sent · same browser', refused: 'Too soon · try again in a moment', failed: 'Could not reach the player' };

function MemoryChallenge({ g, send }: { g: GameState; send: (a: GameAction) => void }) {
  const m = g.tasks.memory;
  return <>
    <p>Watch {m.sequence.length} pulses, then repeat them. Replay as often as you like.</p>
    <div className="sequence-status" aria-live="polite">{m.playing ? <><span>WATCH</span><b>{m.cue ?? '·'}</b></> : m.armed ? <><span>CALIBRATED</span><b>✓</b></> : <><span>REPEAT</span><b>{m.input.length} / {m.sequence.length}</b></>}</div>
    <div className="sequence-buttons">{[1, 2, 3, 4].map(n => <button key={n} className={m.cue === n ? 'cue' : ''} aria-label={`Decoy sequence digit ${n}`} disabled={m.playing || m.armed} onClick={() => send({ type: 'input', value: n })}>{n}</button>)}</div>
    <div className="terminal-actions"><button onClick={() => send({ type: 'replay' })}>Replay sequence</button></div>
    {m.needsReplay && <small className="muted">Paused. Replay when ready.</small>}
  </>;
}

/** The friend's controls in a co-op run: a warning lamp in the shelter and a few remote decoys, each
 * earned by solving one of the player's own puzzles here. The player's game revalidates both. */
export default function FriendControls({ feed, trace }: { feed: CoopManualFeed; trace: TraceSnapshot | null }) {
  const s = trace?.summary, playing = s?.status === 'playing';
  const decoyEvents = (trace?.events ?? []).filter(e => e.type === 'FRIEND_DECOY');
  const used = decoyEvents.length, left = Math.max(0, config.coop.decoy.charges - used);
  const cooldown = s && decoyEvents.length ? Math.max(0, Math.ceil(config.coop.decoy.cooldownSeconds - (s.time - decoyEvents.at(-1)!.time))) : 0;
  const close = !!s && playing && s.linePosition <= config.line.nearPosition + 2;
  const [warnAt, setWarnAt] = useState(-Infinity), [warnNote, setWarnNote] = useState(''), [decoyNote, setDecoyNote] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null), [, tick] = useState(0);
  const live = useRef<Challenge | null>(null);
  live.current = challenge;
  const seed = trace?.seed ?? 0;
  // Memory playback is timed: run the practice copy's clock only while it is open.
  useEffect(() => {
    if (challenge?.kind !== 'memory') return;
    let raf = 0, last = performance.now();
    const frame = (now: number) => {
      const c = live.current;
      if (c?.kind === 'memory' && !challengeSolved(c)) { setChallenge({ ...c, state: step(c.state, Math.min(.1, (now - last) / 1000)) }); }
      last = now; raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [challenge?.kind]);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 500); return () => clearInterval(t); }, []);
  const send = (action: GameAction) => { const c = live.current; if (c) setChallenge({ ...c, state: dispatch(c.state, action) }); };
  async function warn() {
    if (performance.now() - warnAt < config.coop.warnCooldownSeconds * 1000) return;
    setWarnAt(performance.now());
    const result = await feed.send('warn'); setWarnNote(SENT[result]);
  }
  async function fire() {
    if (!challenge || !challengeSolved(challenge)) return;
    const result = await feed.send('decoy');
    setDecoyNote(result === 'remote' || result === 'local' ? 'Decoy fired. Watch the distance.' : SENT[result]);
    if (result === 'remote' || result === 'local') setChallenge(null);
  }
  const warnReady = playing && performance.now() - warnAt >= config.coop.warnCooldownSeconds * 1000;
  const solved = !!challenge && challengeSolved(challenge);
  return <section className="spectate-card friend-controls" aria-label="Your controls">
    <small>YOUR CONTROLS · CO-OP <em>{playing ? 'The player’s game decides what happens' : 'Waiting for the run'}</em></small>
    <button className={`friend-warn${close ? ' urgent' : ''}`} disabled={!warnReady} onClick={() => void warn()}>
      <strong>⚠ It's close · warn them</strong><span>Flashes a red lamp and a chime in the shelter. Use it when the creature nears the wall.</span>
    </button>
    {warnNote && <span role="status">{warnNote}</span>}
    <div className="friend-decoy-card">
      <div className="friend-decoy-head"><b>Remote decoy</b><span aria-label={`${left} of ${config.coop.decoy.charges} decoys left`}>{'●'.repeat(left)}{'○'.repeat(config.coop.decoy.charges - left)}</span></div>
      <p>Solve one of the player's puzzles to arm an emitter far out in the trees. Its noise pulls the creature away for a few seconds. It does nothing once an attack has committed.</p>
      {!challenge ? <button disabled={!playing || left === 0} onClick={() => { setDecoyNote(''); setChallenge(newChallenge(seed, used)); }}>{left === 0 ? 'No decoys left' : 'Arm a decoy'}</button>
        : <div className={`friend-challenge ${challenge.kind}`}>
          <div className="eyebrow">{challenge.kind === 'conduit' ? 'JOIN THE CONDUIT' : 'REPEAT THE SIGNAL'}</div>
          {solved ? <p className="friend-armed">Emitter armed ✓ Fire it when the creature is coming.</p> : challenge.kind === 'conduit' ? <ConduitTask g={challenge.state} send={send} coop={false}/> : <MemoryChallenge g={challenge.state} send={send}/>}
          <div className="terminal-actions"><button className="transmit" disabled={!solved || cooldown > 0 || !playing} onClick={() => void fire()}>{solved ? cooldown > 0 ? `Emitter recharging · ${cooldown}s` : 'Fire the decoy' : 'Solve it to arm'}</button><button className="text-button" onClick={() => setChallenge(null)}>Cancel</button></div>
        </div>}
      {decoyNote && <span role="status">{decoyNote}</span>}
    </div>
  </section>;
}
