import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { createGame, dispatch, step } from '../../src/game/reducer';
import { projectCreature } from '../../src/game/creature';
import { beginStep, startStage } from '../../src/game/tasks';
import { emit, type GameState } from '../../src/game/state';
import { sanitizedTrace } from '../../src/integrations/client';
import type { SensorView } from '../../src/sensing/types';
import SpectateView from '../../src/ui/SpectateView';
import '../../src/ui/style.css';
// The real app loads these through the setup screen (fonts, forest and paper textures).
import '../../src/ui/handdrawn.css';
import '../../src/ui/forest-layers.css';

// Test-only entry point: a real reducer run posted to the spectate page over the same-browser link, with
// SIMULATED vitals. ?mode=coop for a co-op run. The buttons push the run into the states worth checking.
const params = new URLSearchParams(location.search), mode = params.get('mode') === 'coop' ? 'coop' : 'standard';
const channel = `hush-${'5'.repeat(64)}`;
history.replaceState(null, '', `${location.pathname}${location.search}#watch=${encodeURIComponent(btoa(JSON.stringify({ channel })))}`);
const sensor: SensorView = { source: 'simulated', status: 'ready', trend: 'STEADY', quality: 'accepted', hint: '', baselineBpm: 72, pulseBpm: 74, ageMs: 100, sampleAtMs: 0, captureSegment: 0, acceptedSeconds: 30, canContinueManual: true };

function Fixture() {
  const game = useRef<GameState>(createGame(Number(params.get('seed') ?? 17), mode)), pulse = useRef(74), target = useRef<number | null>(null);
  useEffect(() => {
    const out = new BroadcastChannel(channel); let last = performance.now();
    const g = game.current; g.creature.nextMoveAt = 1e9; g.blackout.nextAt = 1e9; g.creature.linePosition = Number(params.get('at') ?? 16); projectCreature(g);
    const timer = setInterval(() => {
      const now = performance.now(); game.current = step(game.current, Math.min(.5, (now - last) / 1000)); last = now;
      const s = game.current;
      if (target.current !== null && s.creature.linePosition !== target.current) { s.creature.linePosition += Math.sign(target.current - s.creature.linePosition); projectCreature(s); emit(s, 'MONSTER_STEP'); if (s.creature.linePosition <= 7 && !s.creature.alarmLatched) { s.creature.alarmLatched = true; emit(s, 'PROXIMITY_ALARM'); } if (s.creature.linePosition >= 10) s.creature.alarmLatched = false; }
      pulse.current += (72 + Math.max(0, 9 - s.creature.linePosition) * 4 - pulse.current) * .15;
      const snapshot = sanitizedTrace(s, sensor);
      snapshot.vitals = { source: 'simulated', status: 'ready', quality: 'accepted', trend: pulse.current > 85 ? 'ELEVATED' : 'STEADY', pulseBpm: Math.round(pulse.current), baselineBpm: 72, fearPct: Math.max(0, Math.min(100, Math.round((pulse.current - 72) * 2.2))), signals: { breathingRpm: Math.round(14 + (pulse.current - 72) * .3), emotion: pulse.current > 85 ? 'fear' : 'neutral', emotionPct: pulse.current > 85 ? 46 : 70, blinksPerMinute: Math.round(15 + (pulse.current - 72) * .4), hrvMs: Math.round(Math.max(18, 44 - (pulse.current - 72))) } };
      out.postMessage(snapshot);
    }, 400);
    return () => { clearInterval(timer); out.close(); };
  }, []);
  const act = (fn: (s: GameState) => void) => () => { fn(game.current); game.current = { ...game.current }; };
  return <>
    <div className="fixture-actions">
      <button onClick={act(() => { target.current = 1; })}>Bring it to the wall</button>
      <button onClick={act(() => { target.current = 18; })}>Send it away</button>
      <button onClick={act(s => { emit(s, 'SCARE', 'impact'); pulse.current += 30; })}>Scare</button>
      <button onClick={act(s => { game.current = dispatch(s, { type: 'quiet' }); })}>Go quiet</button>
      <button onClick={act(s => { startStage(s, Math.min(4, s.tasks.stage + 1) as 2); })}>Next stage</button>
      <button onClick={act(s => { startStage(s, 4); beginStep(s, 'calm'); })}>Calm hold</button>
      <button onClick={act(s => { s.status = 'won'; emit(s, 'WON'); })}>Win</button>
      <button onClick={act(s => { emit(s, 'SCARE', 'breach'); s.status = 'lost'; emit(s, 'LOST'); })}>Lose</button>
    </div>
    <SpectateView/>
  </>;
}
createRoot(document.getElementById('fixture-root')!).render(<Fixture/>);
