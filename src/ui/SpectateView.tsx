import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { SpectateFeed, type SpectateState, type SpectatorVitals } from '../integrations/spectate';
import CctvFeed from '../spectate/CctvFeed';
import ExteriorFeed from '../spectate/ExteriorFeed';
import PulseTrace from '../spectate/PulseTrace';
import Recap, { recapData } from '../spectate/Recap';
import { creatureDistance, METRES_PER_UNIT } from '../spectate/distance';
import { newHighlights, trackHighlights, type Highlight, type HighlightTracker } from '../spectate/highlights';
import { SpectatorSound } from '../spectate/audio';
import { Narrator, narrateEvent, narrateHighlight } from '../spectate/narrator';
import { PredictionFeed, standings, type PredictionState } from '../spectate/predictions';
import type { PropView } from '../integrations/physics';
import type { PublicEvent } from '../game/state';
import { config } from '../game/config';
import { DOOR, OBSTACLES, ROOM } from '../../spacetimedb/src/physicsSim';
import { PREDICTION_LIMITS, type PredictionChoice } from '../../spacetimedb/src/predictRules';
import './spectate.css';
import CoopManual from './CoopManual';
import FriendControls from '../spectate/FriendControls';
import { CoopManualFeed } from '../integrations/coop';
import SpectateCamera from './SpectateCamera';
import { emotionLabel, fearFromPulse, type EmotionLabel } from './vitalsHold';

const HELD_MS = 5000, GONE_MS = 15000, REACTION_MS = 3200;
const TREND: Record<SpectatorVitals['trend'], string> = { UNKNOWN: 'No sustained change yet', STEADY: 'Holding steady', ELEVATED: 'Up and staying up', RECOVERED: 'Coming back down' };
const MOMENTS: Record<string, (detail: string) => string> = {
  RUN_STARTED: () => 'The run started', PROXIMITY_ALARM: () => 'It reached the wall', SCARE: d => d === 'breach' ? 'It broke through' : 'Something hit the door',
  ATTACK_COMMITTED: () => 'It is coming through', WRONG_INPUT: d => `A mistake (${d.toLowerCase() || 'input'})`, TASK_COMPLETE: d => `Stage ${d} complete`,
  LURE_TRANSMITTED: d => `Lure sent to ${d.replace('_', ' ').toLowerCase()}`, QUIET_ENTERED: () => 'Equipment isolated', RESTORED: () => 'Power restored',
  BLACKOUT_STARTED: () => 'Blackout', FRIEND_WARNING: () => 'You warned them', FRIEND_DECOY: () => 'Your decoy fired', DOOR_UNLOCKED: () => 'Your door key turned', RECOVERY_REWARD: () => 'They steadied · it lost their trail', VOICE_HEARD: () => 'It heard them talking', FINAL_BROADCAST: () => 'Final broadcast', WON: () => 'Escaped', LOST: () => 'Lost', TIMEOUT: () => 'Out of time', PAUSED: () => 'Paused', RESUMED: () => 'Resumed',
};
const MOOD: Record<EmotionLabel, string> = { 'FEAR / STARTLE': 'FEAR / ELEVATED', TENSE: 'TENSE', CALM: 'CALM', CALIBRATING: 'CALIBRATING' };
/** Only heart rate is shared, never the player's breathing or expressions, so spectators get an
 * estimate from heart rate, always labelled as one. */
function breathingFromPulse(bpm: number | null, baseline: number | null, trend: SpectatorVitals['trend']): number | null {
  if (bpm === null) return null;
  return Math.max(10, Math.min(32, Math.round(14 + (baseline === null ? 0 : bpm - baseline) * 0.3 + (trend === 'ELEVATED' ? 2 : 0))));
}
const PROP_COLOUR: Record<string, string> = { can: '#a9b28a', mug: '#d1b98a', bolt: '#8d9188', bottle: '#7f9f8f', flashlight: '#d49a5e' };
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function drawShelter(canvas: HTMLCanvasElement | null, props: PropView[]): void {
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  const ratio = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) { canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio); }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, w, h);
  const spanX = ROOM.max[0] - ROOM.min[0], spanZ = ROOM.max[2] - ROOM.min[2], scale = Math.min((w - 24) / spanX, (h - 24) / spanZ);
  const ox = (w - spanX * scale) / 2, oz = (h - spanZ * scale) / 2;
  const px = (x: number) => ox + (x - ROOM.min[0]) * scale, pz = (z: number) => oz + (z - ROOM.min[2]) * scale;
  ctx.fillStyle = '#0d1410'; ctx.strokeStyle = '#5d6a52'; ctx.lineWidth = 2;
  ctx.fillRect(px(ROOM.min[0]), pz(ROOM.min[2]), spanX * scale, spanZ * scale); ctx.strokeRect(px(ROOM.min[0]), pz(ROOM.min[2]), spanX * scale, spanZ * scale);
  ctx.fillStyle = '#1c2219'; ctx.strokeStyle = '#3b4434'; ctx.lineWidth = 1;
  for (const box of OBSTACLES) { ctx.fillRect(px(box.min[0]), pz(box.min[2]), (box.max[0] - box.min[0]) * scale, (box.max[2] - box.min[2]) * scale); ctx.strokeRect(px(box.min[0]), pz(box.min[2]), (box.max[0] - box.min[0]) * scale, (box.max[2] - box.min[2]) * scale); }
  ctx.strokeStyle = '#9a5a36'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(px(DOOR[0] - 0.5), pz(ROOM.max[2])); ctx.lineTo(px(DOOR[0] + 0.5), pz(ROOM.max[2])); ctx.stroke();
  ctx.fillStyle = '#7b7a68'; ctx.font = '9px "Courier New", monospace';
  ctx.fillText('DESK', px(-0.4), pz(-1.85)); ctx.fillText('RACK', px(2.18), pz(0.05)); ctx.fillText('SEALED DOOR', px(DOOR[0] - 0.42), pz(ROOM.max[2]) - 7);
  for (const p of props) {
    // Height reads as a bigger body with a shadow left behind on the floor.
    const r = Math.max(2.5, p.radius * scale * (1 + p.y * 0.55)), x = px(p.x), z = pz(p.z), lift = Math.min(10, p.y * 6);
    ctx.fillStyle = '#0008'; ctx.beginPath(); ctx.arc(x + lift * 0.4, z + lift, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PROP_COLOUR[p.kind] ?? '#999'; ctx.globalAlpha = p.sleeping ? 0.75 : 1;
    ctx.beginPath(); ctx.arc(x, z, r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  }
}

function Vitals({ vitals, age, children }: { vitals: SpectatorVitals | null; age: number | null; children?: ReactNode }) {
  if (!vitals || age === null || age > GONE_MS) return <section className="spectate-card spectate-vitals off"><small>HEART RATE</small><strong>—</strong><span>{vitals ? 'No recent reading from the player.' : 'No heart rate is being shared right now. You can still follow the run.'}</span></section>;
  const held = age > HELD_MS, bpm = vitals.pulseBpm, delta = bpm !== null && vitals.baselineBpm !== null ? bpm - vitals.baselineBpm : null;
  const note = bpm !== null ? TREND[vitals.trend] : vitals.quality === 'rejected' ? 'Reading rejected (movement or lighting)' : vitals.status === 'calibrating' || vitals.status === 'starting' ? 'Calibrating the camera' : vitals.status === 'paused' ? 'Capture paused' : 'No accepted reading right now';
  const fear = fearFromPulse(bpm, vitals.baselineBpm, vitals.trend), mood = fear === null ? null : MOOD[emotionLabel(fear)], rpm = breathingFromPulse(bpm, vitals.baselineBpm, vitals.trend);
  return <section className={`spectate-card spectate-vitals${held ? ' held' : ''}${vitals.trend === 'ELEVATED' ? ' elevated' : ''}`}>
    <small>THEIR STATE <em className={vitals.source}>{vitals.source === 'simulated' ? 'SIMULATED · not a real heart rate' : 'PRESAGE · camera estimate'}</em></small>
    <div className="spectate-readouts">
      <div className={`spectate-readout primary mood-${(mood ?? 'none').split(' ')[0].toLowerCase()}`}><small>EMOTION <em>est. from heart rate</em></small><strong>{fear === null ? '—' : `${fear}%`}</strong><span>{mood ?? 'Calibrating'}</span></div>
      <div className="spectate-readout primary"><small>BREATHING <em>est. from heart rate · not measured</em></small><strong>{rpm ?? '—'}<span>RPM</span></strong></div>
      <div className="spectate-readout"><small>HEART RATE</small><strong><i className="beat" style={bpm ? { animationDuration: `${(60 / bpm).toFixed(2)}s` } : undefined} aria-hidden="true">♥</i>{bpm ?? '—'}<span>BPM</span></strong></div>
    </div>
    {children}
    <span>{delta !== null && <b>{delta > 0 ? '+' : ''}{delta} vs their baseline · </b>}{note}{held && ` · held, no update for ${Math.floor(age / 1000)} s`}</span>
  </section>;
}

/** Spectators call the run before stage 3 and score at the end. Never sent to the player. */
function Predictions({ feed, state, stage, playing, outcome }: { feed: PredictionFeed; state: PredictionState; stage: number; playing: boolean; outcome: 'won' | 'lost' | null }) {
  const [name, setName] = useState(() => { try { return localStorage.getItem('hush-watcher-name') ?? ''; } catch { return ''; } }), [note, setNote] = useState('');
  const open = playing && stage <= PREDICTION_LIMITS.lastStage, mine = state.rows.find(r => r.voter === state.mine);
  const escape = state.rows.filter(r => r.choice === 'escape').length, caught = state.rows.length - escape;
  async function call(choice: PredictionChoice) {
    const display = name.trim() || `Watcher ${(state.mine ?? '0000').slice(0, 4)}`;
    try { localStorage.setItem('hush-watcher-name', name.trim()); } catch { /* storage blocked */ }
    const result = await feed.predict(choice, display, stage);
    setNote(result === 'remote' || result === 'local' ? `Locked in: ${choice === 'escape' ? 'they escape' : 'it gets them'}. You can change it until stage 3.` : result === 'closed' ? 'Predictions are closed.' : result === 'invalid' ? 'Use letters, digits, spaces, . _ or - (16 at most).' : 'Could not send. Try again.');
  }
  const board = outcome ? standings(state.rows, outcome) : [];
  return <section className="spectate-card spectate-predict" aria-label="Predictions">
    <small>PREDICTIONS <em>{outcome ? 'final' : open ? 'open until stage 3' : 'closed'}</em></small>
    {outcome ? board.length ? <ol className="spectate-standings">{board.slice(0, 8).map((s, i) => <li key={s.voter} className={s.voter === state.mine ? 'mine' : ''}><span>{i + 1}. {s.name}</span><em>{s.choice === 'escape' ? 'escape' : 'caught'} · stage {s.stage}</em><b>{s.points}</b></li>)}</ol> : <span>No one made a call this run.</span>
      : <>
        <strong>{mine ? (mine.choice === 'escape' ? 'You said: they escape' : 'You said: it gets them') : 'Will they make it?'}</strong>
        <label className="spectate-name">Your name <input value={name} maxLength={16} placeholder="Watcher" onChange={e => setName(e.target.value)} disabled={!open}/></label>
        <div className="spectate-predict-buttons"><button disabled={!open} className={mine?.choice === 'escape' ? 'on' : ''} onClick={() => void call('escape')}>They escape</button><button disabled={!open} className={mine?.choice === 'caught' ? 'on' : ''} onClick={() => void call('caught')}>It gets them</button></div>
        <span>{state.rows.length ? `${escape} say escape · ${caught} say caught` : 'No calls yet.'} Earlier calls score more: 200 in stage 1, 150 in stage 2.</span>
        {note && <span role="status">{note}</span>}
      </>}
    <span className="muted">{state.status}</span>
  </section>;
}

export default function SpectateView() {
  const canvas = useRef<HTMLCanvasElement>(null), feed = useRef<SpectateFeed | null>(null);
  const [state, setState] = useState<SpectateState | null>(null), [now, setNow] = useState(() => performance.now());
  const propsAt = useCallback((t: number) => feed.current?.props(t) ?? [], []);
  // Highlights, every event seen this run (deduplicated), sound, narrator, reaction and predictions.
  const highlights = useRef<HighlightTracker>(newHighlights()), seenEvents = useRef(new Map<number, PublicEvent>()), lastSeq = useRef<number | null>(null), lastBpm = useRef<number | null>(null);
  const [found, setFound] = useState<Highlight[]>([]), sound = useRef<SpectatorSound | null>(null), narrator = useRef<Narrator | null>(null);
  const [soundOn, setSoundOn] = useState(false), [heartbeat, setHeartbeat] = useState(true), [narrate, setNarrate] = useState(false), [caption, setCaption] = useState<string | null>(null);
  const [reaction, setReaction] = useState<{ at: number; until: number; time: number; from: number | null; kind: string } | null>(null), [cameraLive, setCameraLive] = useState(false);
  const [predictions, setPredictions] = useState<PredictionFeed | null>(null), [predicted, setPredicted] = useState<PredictionState>({ rows: [], mine: null, status: 'Connecting' });
  const live = useRef(state); live.current = state;
  useEffect(() => {
    const current = feed.current = new SpectateFeed(location.hash), off = current.subscribe(setState), tick = setInterval(() => setNow(performance.now()), 500);
    let raf = requestAnimationFrame(function frame(t) {
      drawShelter(canvas.current, current.props(t));
      const s = live.current;
      sound.current?.update(s?.trace ?? null, s?.vitals ?? null, runSeconds(s, t), t);
      raf = requestAnimationFrame(frame);
    });
    const calls = new PredictionFeed(location.hash), offPredict = calls.subscribe(setPredicted); setPredictions(calls);
    return () => { off(); offPredict(); clearInterval(tick); cancelAnimationFrame(raf); current.dispose(); calls.dispose(); sound.current?.dispose(); narrator.current?.stop(); if (feed.current === current) feed.current = null; };
  }, []);
  const trace = state?.trace, s = trace?.summary, traceAge = state?.traceReceivedAt == null ? null : now - state.traceReceivedAt;
  const coop = trace?.mode === 'coop', [coopFeed, setCoopFeed] = useState<CoopManualFeed | null>(null);
  // One manual feed per page in co-op: it carries the live pacer page and the friend's warning and decoys.
  useEffect(() => { if (!coop) return; const next = new CoopManualFeed(location.hash); setCoopFeed(next); return () => { next.dispose(); setCoopFeed(null); }; }, [coop]);
  const bpm = state?.vitals?.pulseBpm ?? null;

  // Every new update: fold highlights, record events, react to scares, narrate.
  useEffect(() => {
    if (!trace) return;
    const newest = trace.events.reduce((max, e) => Math.max(max, e.seq), 0);
    const restarted = lastSeq.current !== null && newest < lastSeq.current;
    if (restarted) { seenEvents.current.clear(); setReaction(null); }
    const { next, found: fresh } = trackHighlights(restarted ? newHighlights() : highlights.current, trace, bpm);
    highlights.current = next; if (fresh.length || restarted) setFound([...next.highlights]);
    const primed = lastSeq.current !== null && !restarted, before = restarted ? 0 : lastSeq.current ?? newest;
    for (const e of trace.events) seenEvents.current.set(e.seq, e);
    if (seenEvents.current.size > 1200) for (const seq of [...seenEvents.current.keys()].slice(0, 200)) seenEvents.current.delete(seq);
    if (primed) {
      const metres = trace.summary.linePosition * METRES_PER_UNIT, context = { bpm, metres, locks: Math.max(0, trace.summary.stage - 1), equipment: trace.summary.equipment };
      for (const e of trace.events) if (e.seq > before) {
        if ((e.type === 'SCARE' && e.detail !== 'breach') || e.type === 'ATTACK_COMMITTED') { const t = performance.now(); setReaction({ at: t, until: t + REACTION_MS, time: e.time, from: lastBpm.current ?? bpm, kind: e.type }); } // measured from the reading before the scare
        if (narrator.current) narrator.current.say(narrateEvent(e, { ...context, locks: e.type === 'TASK_COMPLETE' ? Number(e.detail) || context.locks : context.locks }));
      }
      if (narrator.current) for (const h of fresh) narrator.current.say(narrateHighlight(h));
    }
    lastSeq.current = newest; lastBpm.current = bpm;
  }, [trace, bpm]);
  useEffect(() => { if (reaction && now > reaction.until + 6000) setReaction(null); }, [now, reaction]);

  async function toggleSound() {
    if (sound.current?.running) { sound.current.stop(); narrator.current?.stop(); narrator.current = null; setSoundOn(false); setNarrate(false); return; }
    const next = sound.current ?? (sound.current = new SpectatorSound());
    next.setOptions({ heartbeat }); await next.start().catch(() => undefined); setSoundOn(true);
  }
  function toggleNarrator() {
    if (narrator.current) { narrator.current.stop(); narrator.current = null; setNarrate(false); return; }
    const voice = narrator.current = new Narrator(setCaption);
    voice.skip(trace?.events.map(e => e.id) ?? []); voice.skip(highlights.current.highlights.map(h => h.id));
    setNarrate(true);
  }
  const moments = (trace?.events ?? []).filter(e => MOMENTS[e.type]).slice(-6).reverse();
  // Run time carried forward between updates (at most 2 s) so the distance keeps drifting smoothly.
  const seconds = runSeconds(state, now), distance = s ? creatureDistance(s.linePosition, seconds, trace!.seed) : null;
  const playing = s?.status === 'playing', over = s && (s.status === 'won' || s.status === 'lost') ? s.status : null;
  const spotlight = !!reaction && now < reaction.until, cctvSpotlight = spotlight && !cameraLive;
  const afterRise = reaction && reaction.from !== null ? Math.max(...highlights.current.pulse.filter(p => p.time >= reaction.time - 0.5 && p.time <= reaction.time + 10).map(p => p.bpm), bpm ?? reaction.from, reaction.from) : null;
  const recap = over && s ? recapData(over, s.time, s.stage, trace!.mode, [...seenEvents.current.values()], found, highlights.current.pulse, standings(predicted.rows, over)) : null;
  const interference = coop && playing && !!s && s.linePosition <= config.line.nearPosition;
  return <main className="judge-page spectate-page">
    <div className="eyebrow">HUSH / SPECTATING · READ ONLY</div>
    <h1>{trace?.mode === 'coop' ? "You're their lifeline." : "You're watching."}</h1>
    <p className="small muted">{state?.status ?? 'Connecting'}{traceAge !== null && traceAge > HELD_MS && ` · no update for ${Math.floor(traceAge / 1000)} s`}</p>
    <div className="spectate-sound" role="group" aria-label="Sound">
      <button className={soundOn ? 'on' : ''} aria-pressed={soundOn} onClick={() => void toggleSound()}>{soundOn ? '🔊 Sound on' : '🔈 Tap for sound'}</button>
      {soundOn && <label><input type="checkbox" checked={heartbeat} onChange={e => { setHeartbeat(e.target.checked); sound.current?.setOptions({ heartbeat: e.target.checked }); }}/> Their heartbeat</label>}
      {soundOn && <label><input type="checkbox" checked={narrate} onChange={toggleNarrator} disabled={!Narrator.available}/> Narrator <em>browser voice</em></label>}
      <span className="muted">{soundOn ? 'What they hear, rebuilt on this device from the game events. Headphones help.' : 'Footsteps, the pounding, the scares, and their heartbeat if shared.'}</span>
    </div>
    {recap && <Recap data={recap}/>}
    {coop && coopFeed && trace && <CoopManual hash={location.hash} feed={coopFeed} seed={trace.seed} metres={distance ? distance.metres : null} interference={interference}/>}
    <div className="spectate-main">
      <div className="spectate-feeds">
        <section className={`spectate-card spectate-cctv-card${cctvSpotlight ? ' spotlight' : ''}`} aria-label="Shelter camera">
          <small>SHELTER CAMERA <em>DRAWN ON THIS DEVICE FROM THE GAME STATE · NOT THE PLAYER’S WEBCAM</em></small>
          <CctvFeed trace={trace ?? null} propsAt={propsAt} />
        </section>
        <section className="spectate-card spectate-exterior-card" aria-label="Outside camera">
          <small>OUTSIDE CAMERA <em>ONLY YOU CAN SEE THIS · THE PLAYER HAS NO CAMERAS</em></small>
          <ExteriorFeed trace={trace ?? null} seconds={() => runSeconds(live.current, performance.now())}/>
        </section>
      </div>
      <div className="spectate-side">
        {coop && coopFeed && <FriendControls feed={coopFeed} trace={trace ?? null}/>}
        <SpectateCamera hash={location.hash} spotlight={spotlight} onLive={setCameraLive}/>
        <Vitals vitals={state?.vitals ?? null} age={state?.vitalsReceivedAt == null ? null : now - state.vitalsReceivedAt}>
          {s && <PulseTrace samples={highlights.current.pulse} baseline={state?.vitals?.baselineBpm ?? null} events={trace!.events} now={s.time}/>}
        </Vitals>
        {s && distance ? <section className="spectate-card">
          <small>THE RUN</small>
          <strong>{s.status === 'won' ? 'Escaped' : s.status === 'lost' ? 'Lost' : s.stage >= 5 ? 'Final broadcast' : `Stage ${s.stage} of 4`}</strong>
          <span>{clock(s.time)} · equipment {s.equipment} · {'●'.repeat(s.quietChargesRemaining)}{'○'.repeat(Math.max(0, 3 - s.quietChargesRemaining))} isolation</span>
          <label className="spectate-meter"><span>Creature · {distance.atWall ? distance.label : `${distance.label} from the wall`} · {s.creaturePhase}</span><meter min={0} max={s.lineLength * METRES_PER_UNIT} low={7 * METRES_PER_UNIT} high={10 * METRES_PER_UNIT} optimum={s.lineLength * METRES_PER_UNIT} value={distance.metres} /></label>
          <label className="spectate-meter"><span>Exposure · {s.danger}%</span><meter min={0} max={100} low={40} high={70} optimum={0} value={s.danger} /></label>
        </section> : <section className="spectate-card off"><small>THE RUN</small><strong>Waiting</strong><span>Keep this page open. It updates when the player is in a run with sharing on.</span></section>}
        {s && predictions && trace?.mode !== 'tutorial' && <Predictions feed={predictions} state={predicted} stage={s.stage} playing={!!playing} outcome={over}/>}
      </div>
    </div>
    <div className="spectate-grid">
      <section className="spectate-card spectate-room">
        <small>MAP <em>{state?.physics === 'spacetime' ? 'PROPS · SPACETIMEDB PHYSICS' : 'PROPS · LOCAL REPLAY (OFFLINE)'}</em></small>
        <canvas ref={canvas} role="img" aria-label="Top-down map of the shelter. Loose props move when the creature hits the door." />
      </section>
      <section className="spectate-card">
        <small>MOMENTS</small>
        {found.length > 0 && <ul className="spectate-highlights" aria-label="Highlights">{found.slice(-4).reverse().map(h => <li key={h.id} className={h.kind}>{h.text}</li>)}</ul>}
        <ol className="spectate-moments">{moments.length ? moments.map(e => <li key={e.id}><time>{clock(e.time)}</time>{MOMENTS[e.type]!(e.detail)}</li>) : <li>Nothing yet.</li>}</ol>
      </section>
    </div>
    {reaction && reaction.from !== null && afterRise !== null && now < reaction.until + 6000 && <div className="spectate-reaction-toast" role="status"><b>♥ {afterRise - reaction.from >= 3 ? `${reaction.from} → ${afterRise}` : reaction.from} BPM</b><span>{reaction.kind === 'ATTACK_COMMITTED' ? 'as it came through' : 'after the hit on the door'}</span></div>}
    {caption && <p className="spectate-narration" aria-live="polite">{caption}</p>}
    <p className="small muted spectate-privacy">You see game events, the creature's distance, cameras your own browser draws from those events (the player has none) and, only if the player turned it on, their current heart rate. Sound and the narrator are rebuilt on this device from the same events. When enabled, their webcam streams directly to you without being recorded. In co-op, the manual has every answer for this run: the player describes what they see and you look it up. Warn them when it gets close, and earn decoys; their game checks every action and decides what happens. Predictions are only seen by other spectators. A camera pulse estimate is a game input, not a medical reading.</p>
  </main>;
}

/** Run time carried forward from the last update (at most 2 s while playing), on this page's clock. */
function runSeconds(state: SpectateState | null, nowMs: number): number {
  const s = state?.trace?.summary;
  if (!s) return 0;
  const age = state!.traceReceivedAt == null ? 0 : nowMs - state!.traceReceivedAt;
  return s.time + (s.status === 'playing' ? Math.min(2, Math.max(0, age) / 1000) : 0);
}
