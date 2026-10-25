import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { SpectateFeed, type SpectateState, type SpectatorVitals } from '../integrations/spectate';
import type { TraceSnapshot } from '../integrations/client';
import CctvFeed from '../spectate/CctvFeed';
import PulseTrace from '../spectate/PulseTrace';
import Recap, { recapData } from '../spectate/Recap';
import { PlayerWalker, type PlayerView } from '../spectate/player';
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
import { Heartbeat, WornTitle } from './Worn';
import './spectate-worn.css';
import SpectateCamera from './SpectateCamera';
import { readSpectatorFear, spectatorFearMemory } from './vitalsHold';

const HELD_MS = 5000, GONE_MS = 15000, REACTION_MS = 3200;
const TREND: Record<SpectatorVitals['trend'], string> = { UNKNOWN: 'No sustained change yet', STEADY: 'Holding steady', ELEVATED: 'Up and staying up', RECOVERED: 'Coming back down' };
const MOMENTS: Record<string, (detail: string) => string> = {
  RUN_STARTED: () => 'The run started', PROXIMITY_ALARM: () => 'It reached the wall', SCARE: d => d === 'breach' ? 'It broke through' : 'Something hit the door',
  ATTACK_COMMITTED: () => 'It is coming through', WRONG_INPUT: d => `A mistake (${d.toLowerCase() || 'input'})`, TASK_COMPLETE: d => `Stage ${d} complete`,
  LURE_TRANSMITTED: d => `Lure sent to ${d.replace('_', ' ').toLowerCase()}`, QUIET_ENTERED: () => 'Equipment isolated', RESTORED: () => 'Power restored',
  BLACKOUT_STARTED: () => 'Blackout', FRIEND_WARNING: () => 'You warned them', FRIEND_DECOY: () => 'Your decoy fired', DOOR_UNLOCKED: () => 'Your door key turned', RECOVERY_REWARD: () => 'They steadied · it lost their trail', VOICE_HEARD: () => 'It heard them talking', FINAL_BROADCAST: () => 'Final broadcast', WON: () => 'Escaped', LOST: () => 'Lost', TIMEOUT: () => 'Out of time', PAUSED: () => 'Paused', RESUMED: () => 'Resumed',
};
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const PROP_COLOUR: Record<string, string> = { can: '#a9b28a', mug: '#d1b98a', bolt: '#8d9188', bottle: '#7f9f8f', flashlight: '#d49a5e' };

function drawShelter(canvas: HTMLCanvasElement | null, props: PropView[], player: PlayerView | null): void {
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
  if (player) {
    // The player's researcher, the same figure the shelter camera shows: a dot facing their way.
    const x = px(player.x), z = pz(player.z), r = Math.max(4, .17 * scale);
    ctx.strokeStyle = '#e6dfc0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, z); ctx.lineTo(x + Math.sin(player.heading) * r * 2, z + Math.cos(player.heading) * r * 2); ctx.stroke();
    ctx.fillStyle = '#e6dfc0'; ctx.beginPath(); ctx.arc(x, z, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7b7a68'; ctx.fillText('PLAYER', x + r + 4, z - r);
  }
}

/** One FEAR reading for the spectator in place of separate heart-rate and breathing numbers: the
 * player's device combines its camera estimates (face, heart rate, breathing, skin response) into
 * one percentage, held through dropouts; an older player build only lets it be estimated from heart
 * rate (vitalsHold.ts). */
function Fear({ vitals, age, now, children }: { vitals: SpectatorVitals | null; age: number | null; now: number; children?: ReactNode }) {
  const memory = useRef(spectatorFearMemory());
  if (!vitals || age === null || age > GONE_MS) {
    // Not shared (or gone): forget the last reading, so a re-enabled share never resurfaces it.
    memory.current = spectatorFearMemory();
    return <section className="spectate-card spectate-vitals spectate-fear off"><small>FEAR</small><strong>—</strong><span>{vitals ? 'No recent reading' : 'Not shared'}</span></section>;
  }
  const fear = readSpectatorFear(memory.current, vitals, now), held = age > HELD_MS || fear.fearPct !== null && !fear.live;
  const status = vitals.status === 'calibrating' || vitals.status === 'starting' ? 'Calibrating their camera' : vitals.status === 'paused' ? 'Capture paused' : vitals.quality === 'rejected' ? 'Reading rejected (movement or lighting)' : 'Waiting for a reading';
  const note = fear.fearPct === null ? status : fear.live ? TREND[fear.trend] : `${status} · showing their last reading`;
  return <section className={`spectate-card spectate-vitals spectate-fear mood-${fear.label.toLowerCase()}${held ? ' held' : ''}`}>
    <small>FEAR <em className={vitals.source}>{vitals.source === 'simulated' ? 'SIMULATED' : fear.basis === 'heart rate' ? 'FROM THEIR HEART RATE' : 'FROM THEIR CAMERA'}</em></small>
    <strong>{fear.fearPct === null ? '—' : `${fear.fearPct}%`}<span>{fear.label}</span></strong>
    <div className="spectate-meter"><meter aria-label="Fear level" min={0} max={100} low={25} high={50} optimum={0} value={fear.fearPct ?? 0} /></div>
    {children}
    <span>{note}{age > HELD_MS && ` · held, no update for ${Math.floor(age / 1000)} s`}</span>
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
  // One walker for the camera and the map, so both show the researcher in the same place.
  const [walker] = useState(() => new PlayerWalker()), [motion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)')), latestTrace = useRef<TraceSnapshot | null>(null);
  const playerAt = useCallback((t: number) => walker.at(latestTrace.current, t, motion.matches), [walker, motion]);
  // Highlights, every event seen this run (deduplicated), sound, narrator, reaction and predictions.
  const highlights = useRef<HighlightTracker>(newHighlights()), seenEvents = useRef(new Map<number, PublicEvent>()), lastSeq = useRef<number | null>(null), lastBpm = useRef<number | null>(null);
  const [found, setFound] = useState<Highlight[]>([]), sound = useRef<SpectatorSound | null>(null), narrator = useRef<Narrator | null>(null);
  const [soundOn, setSoundOn] = useState(false), [heartbeat, setHeartbeat] = useState(true), [narrate, setNarrate] = useState(false), [caption, setCaption] = useState<string | null>(null);
  const [reaction, setReaction] = useState<{ at: number; until: number; time: number; from: number | null; kind: string } | null>(null), [cameraLive, setCameraLive] = useState(false);
  const [predictions, setPredictions] = useState<PredictionFeed | null>(null), [predicted, setPredicted] = useState<PredictionState>({ rows: [], mine: null, status: 'Connecting' });
  const live = useRef(state); live.current = state;
  useEffect(() => {
    const current = feed.current = new SpectateFeed(location.hash), off = current.subscribe(next => { latestTrace.current = next.trace; setState(next); }), clock = setInterval(() => setNow(performance.now()), 500);
    let raf = requestAnimationFrame(function frame(t) {
      drawShelter(canvas.current, current.props(t), playerAt(t));
      const s = live.current;
      sound.current?.update(s?.trace ?? null, s?.vitals ?? null, runSeconds(s, t), t);
      raf = requestAnimationFrame(frame);
    });
    const calls = new PredictionFeed(location.hash), offPredict = calls.subscribe(setPredicted); setPredictions(calls);
    return () => { off(); offPredict(); clearInterval(clock); cancelAnimationFrame(raf); current.dispose(); calls.dispose(); sound.current?.dispose(); narrator.current?.stop(); if (feed.current === current) feed.current = null; };
  }, []);
  const coop = state?.trace?.mode === 'coop', [coopFeed, setCoopFeed] = useState<CoopManualFeed | null>(null);
  // One manual feed per page in co-op: it carries the live pacer page and the friend's warning and decoys.
  useEffect(() => { if (!coop) return; const next = new CoopManualFeed(location.hash); setCoopFeed(next); return () => { next.dispose(); setCoopFeed(null); }; }, [coop]);
  const trace = state?.trace, s = trace?.summary, traceAge = state?.traceReceivedAt == null ? null : now - state.traceReceivedAt;
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
        // The rise is measured from the reading before this update (the one carrying the scare may already show it).
        if ((e.type === 'SCARE' && e.detail !== 'breach') || e.type === 'ATTACK_COMMITTED') { const t = performance.now(); setReaction({ at: t, until: t + REACTION_MS, time: e.time, from: lastBpm.current ?? bpm, kind: e.type }); }
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
  const moments = (trace?.events ?? []).filter(e => MOMENTS[e.type]).slice(-4).reverse();
  // Run time carried forward between updates (at most 2 s) so the distance keeps drifting smoothly.
  const seconds = runSeconds(state, now), distance = s ? creatureDistance(s.linePosition, seconds, trace!.seed) : null;
  const playing = s?.status === 'playing', over = s && (s.status === 'won' || s.status === 'lost') ? s.status : null;
  const spotlight = !!reaction && now < reaction.until, cctvSpotlight = spotlight && !cameraLive;
  const afterRise = reaction && reaction.from !== null ? Math.max(...highlights.current.pulse.filter(p => p.time >= reaction.time - 0.5 && p.time <= reaction.time + 10).map(p => p.bpm), bpm ?? reaction.from, reaction.from) : null;
  const recap = over && s ? recapData(over, s.time, s.stage, trace!.mode, [...seenEvents.current.values()], found, highlights.current.pulse, standings(predicted.rows, over)) : null;
  const interference = coop && playing && !!s && s.linePosition <= config.line.nearPosition;
  return <main className="judge-page spectate-page">
    <div className="spectate-backdrop" aria-hidden="true"/>
    <header className="spectate-head"><WornTitle text={trace?.mode==='coop'?'LIFELINE':'WATCHING'}/><Heartbeat/>
      <p className="spectate-status">{state?.status ?? 'Connecting'}{traceAge !== null && traceAge > HELD_MS && ` · no update for ${Math.floor(traceAge / 1000)} s`}</p>
      <div className="spectate-sound" role="group" aria-label="Sound">
        <button className={soundOn ? 'on' : ''} aria-pressed={soundOn} onClick={() => void toggleSound()}>{soundOn ? 'Sound on' : 'Tap for sound'}</button>
        {soundOn && <label><input type="checkbox" checked={heartbeat} onChange={e => { setHeartbeat(e.target.checked); sound.current?.setOptions({ heartbeat: e.target.checked }); }}/> Their heartbeat</label>}
        {soundOn && <label><input type="checkbox" checked={narrate} onChange={toggleNarrator} disabled={!Narrator.available}/> Narrator</label>}
      </div></header>
    <div className="spectate-columns">
    {/* The footage stays pinned on the left; everything to read scrolls on the right. */}
    <div className="spectate-scroll">
    {recap && <Recap data={recap}/>}
    {coop&&coopFeed&&trace&&<CoopManual hash={location.hash} feed={coopFeed} seed={trace.seed} metres={distance ? distance.metres : null} interference={interference}/>}
    {coop&&coopFeed&&<FriendControls feed={coopFeed} trace={trace ?? null}/>}
    <div className="spectate-side">
        <Fear vitals={state?.vitals ?? null} age={state?.vitalsReceivedAt == null ? null : now - state.vitalsReceivedAt} now={now}>
          {s && <PulseTrace samples={highlights.current.pulse} baseline={state?.vitals?.baselineBpm ?? null} events={trace!.events} now={s.time}/>}
        </Fear>
        {s && distance ? <section className="spectate-card">
          <small>THE RUN</small>
          <strong>{s.status === 'won' ? 'Escaped' : s.status === 'lost' ? 'Lost' : s.stage >= 5 ? 'Final broadcast' : `Stage ${s.stage} of 4`}</strong>
          <span>{clock(s.time)} · power {s.equipment} · {'●'.repeat(s.quietChargesRemaining)}{'○'.repeat(Math.max(0, 3 - s.quietChargesRemaining))}</span>
          <label className="spectate-meter"><span>Creature · {distance.atWall ? distance.label : `${distance.label} from the wall`}</span><meter min={0} max={s.lineLength * METRES_PER_UNIT} low={7 * METRES_PER_UNIT} high={10 * METRES_PER_UNIT} optimum={s.lineLength * METRES_PER_UNIT} value={distance.metres} /></label>
          <label className="spectate-meter"><span>Exposure · {s.danger}%</span><meter min={0} max={100} low={40} high={70} optimum={0} value={s.danger} /></label>
        </section> : <section className="spectate-card off"><small>THE RUN</small><strong>Waiting</strong><span>Keep this page open.</span></section>}
        {s && predictions && trace?.mode !== 'tutorial' && <Predictions feed={predictions} state={predicted} stage={s.stage} playing={!!playing} outcome={over}/>}
    </div>
    <div className="spectate-grid">
      <section className="spectate-card spectate-room">
        <small>MAP</small>
        <canvas ref={canvas} role="img" aria-label="Top-down map of the shelter. The light dot is the player. Loose props move when the creature hits the door." />
      </section>
      <section className="spectate-card">
        <small>MOMENTS</small>
        {found.length > 0 && <ul className="spectate-highlights" aria-label="Highlights">{found.slice(-3).reverse().map(h => <li key={h.id} className={h.kind}>{h.text}</li>)}</ul>}
        <ol className="spectate-moments">{moments.length ? moments.map(e => <li key={e.id}><time>{clock(e.time)}</time>{MOMENTS[e.type]!(e.detail)}</li>) : <li>Nothing yet.</li>}</ol>
      </section>
    </div>
    </div>
    <aside className="spectate-footage" aria-label="Footage">
      <section className={`spectate-card spectate-cctv-card${cctvSpotlight ? ' spotlight' : ''}`} aria-label="Shelter camera">
        <small>SHELTER CAMERA</small>
        <CctvFeed trace={trace ?? null} propsAt={propsAt} playerAt={playerAt} />
      </section>
      <SpectateCamera hash={location.hash} spotlight={spotlight} onLive={setCameraLive}/>
    </aside>
    </div>
    {reaction && reaction.from !== null && afterRise !== null && now < reaction.until + 6000 && <div className="spectate-reaction-toast" role="status"><b>♥ {afterRise - reaction.from >= 3 ? `${reaction.from} → ${afterRise}` : reaction.from} BPM</b><span>{reaction.kind === 'ATTACK_COMMITTED' ? 'as it came through' : 'after the hit on the door'}</span></div>}
    {caption && <p className="spectate-narration" aria-live="polite">{caption}</p>}
    <p className="spectate-privacy">Nothing is recorded · sound, cameras and the narrator are rebuilt on this device from the game · fear is a camera estimate from their face, breathing and heart rate, not a medical reading · spectators can't change the run{coop ? " · their game checks every warning and decoy" : ""}.</p>
  </main>;
}

/** Run time carried forward from the last update (at most 2 s while playing), on this page's clock. */
function runSeconds(state: SpectateState | null, nowMs: number): number {
  const s = state?.trace?.summary;
  if (!s) return 0;
  const age = state!.traceReceivedAt == null ? 0 : nowMs - state!.traceReceivedAt;
  return s.time + (s.status === 'playing' ? Math.min(2, Math.max(0, age) / 1000) : 0);
}
