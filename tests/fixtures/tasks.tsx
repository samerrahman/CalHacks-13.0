import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import HUD from '../../src/ui/HUD';
import { createGame, dispatch, step } from '../../src/game/reducer';
import { memoryRounds, startStage } from '../../src/game/tasks';
import type { GameAction, GameState } from '../../src/game/state';
import '../../src/ui/style.css';

// Test-only entry point: the real HUD over states built with the real reducer. No scene, audio, camera or providers.
type Which = 'faults' | 'wires' | 'routing' | 'pulse' | 'locate' | 'calm';
function build(which: Which): GameState {
  let s = createGame(17); s.time = 60; s.creature.nextMoveAt = 1e6; s.blackout.nextAt = 1e6; s.creature.linePosition = 16; s.creature.sensorDistance = 16; s.creature.sensorSampleAt = 58;
  if (which === 'faults') return s;
  if (which === 'pulse' || which === 'calm') {
    startStage(s, which === 'pulse' ? 2 : 4);
    for (let round = 0; round < memoryRounds(s).rounds; round++) { while (s.tasks.memory.playing) s = step(s, .2); for (const value of [...s.tasks.memory.sequence]) s = dispatch(s, { type: 'input', value }); }
    return s;
  }
  if (which === 'locate') startStage(s, 3);
  s.tasks.faults.completed = s.tasks.faults.required; s.tasks.faults.active = []; s.tasks.faults.spawned = s.tasks.faults.required; s.tasks.step = 'wires';
  if (which === 'wires') { for (let from = 0; from < 7; from++) s = dispatch(s, { type: 'wire', from, to: s.tasks.wires.targetOrder.indexOf(from) }); return s; }
  for (let from = 0; from < s.tasks.wires.connections.length; from++) s = dispatch(s, { type: 'wire', from, to: s.tasks.wires.targetOrder.indexOf(from) });
  if (which === 'locate') s = dispatch(s, { type: 'station', station: 'cameras' });
  return s;
}
function TaskFixture() {
  const [which, setWhich] = useState<Which>((location.hash.slice(1) as Which) || 'routing');
  const [game, setGame] = useState(() => build(which));
  useEffect(() => { setGame(build(which)); if (location.hash.slice(1) !== which) location.hash = which; }, [which]);
  useEffect(() => { const follow = () => setWhich((location.hash.slice(1) as Which) || 'routing'); addEventListener('hashchange', follow); return () => removeEventListener('hashchange', follow); }, []);
  useEffect(() => { const timer = setInterval(() => setGame(g => step(g, .09)), 90); return () => clearInterval(timer); }, []);
  const send = (action: GameAction) => setGame(g => dispatch(g, action));
  return <><div className="fixture-steps">{(['faults', 'wires', 'routing', 'pulse', 'locate', 'calm'] as Which[]).map(w => <button key={w} onClick={() => setWhich(w)}>{w}</button>)}</div>
    <HUD game={game} send={send} onPause={() => {}} onJudge={() => {}} muted={false} setMuted={() => {}} sensorLabel="TEST FIXTURE · NEUTRAL" radio={null} radioRole="supervisor" radioSource="" inspection onOpen={() => {}} onClose={() => {}} onCamera={() => {}}/></>;
}
createRoot(document.getElementById('fixture-root')!).render(<TaskFixture/>);
