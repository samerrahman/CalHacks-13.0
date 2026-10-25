import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import WirePuzzle from '../../src/ui/WirePuzzle';
import { ConduitTask, FaultTask } from '../../src/ui/ThinkingTasks';
import { ManualPage } from '../../src/ui/CoopManual';
import { coopManual } from '../../src/game/coop';
import { createGame, dispatch, step } from '../../src/game/reducer';
import type { GameAction, GameState } from '../../src/game/state';
import '../../src/ui/style.css';
import '../../src/ui/survival.css';
import '../../src/ui/spectate.css';

// Test-only entry point: co-op states from the real reducer. #player-<step> is what the player sees, #friend-<step> the manual.
type Which = 'faults' | 'wires' | 'routing';
function build(which: Which): GameState {
  let s = createGame(17, 'coop'); s.creature.nextMoveAt = 1e6; s.blackout.nextAt = 1e6;
  while (!s.tasks.faults.active.length) s = step(s, .1);
  if (which === 'faults') return s;
  s.tasks.faults.completed = s.tasks.faults.required; s.tasks.faults.active = []; s.tasks.faults.spawned = s.tasks.faults.required; s.tasks.step = 'wires';
  if (which === 'wires') { for (let from = 0; from < 2; from++) s = dispatch(s, { type: 'wire', from, to: s.tasks.wires.targetOrder.indexOf(from) }); return s; }
  for (let from = 0; from < s.tasks.wires.connections.length; from++) s = dispatch(s, { type: 'wire', from, to: s.tasks.wires.targetOrder.indexOf(from) });
  return s;
}
function read(): { view: 'player' | 'friend'; which: Which } {
  const [view, which] = location.hash.slice(1).split('-');
  return { view: view === 'friend' ? 'friend' : 'player', which: (['faults', 'wires', 'routing'].includes(which ?? '') ? which : 'faults') as Which };
}
function Fixture() {
  const [{ view, which }, setRoute] = useState(read), [game, setGame] = useState(() => build(read().which));
  useEffect(() => { const follow = () => { setRoute(read()); setGame(build(read().which)); }; addEventListener('hashchange', follow); return () => removeEventListener('hashchange', follow); }, []);
  const send = (action: GameAction) => setGame(g => dispatch(g, action));
  const steps = <div className="fixture-steps">{(['player', 'friend'] as const).flatMap(v => (['faults', 'wires', 'routing'] as Which[]).map(w => <button key={v + w} onClick={() => { location.hash = `${v}-${w}`; }}>{v} {w}</button>))}</div>;
  if (view === 'friend') return <>{steps}<main className="judge-page spectate-page"><div className="eyebrow">HUSH / SPECTATING · TEST FIXTURE</div>
    <section className="spectate-card coop-manual"><small>THE MANUAL · CO-OP <em>TEST FIXTURE · real reducer state</em></small><ManualPage manual={coopManual(game)}/></section></main></>;
  return <>{steps}<section className="task-panel terminal-inspection" role="dialog" aria-label="Research terminal"><div className="eyebrow">RESEARCH 01 / 04 · CO-OP · TEST FIXTURE</div>
    {which === 'wires' ? <WirePuzzle wires={game.tasks.wires} connect={(from, to) => send({ type: 'wire', from, to })} coop/> : which === 'routing' ? <ConduitTask g={game} send={send}/> : <FaultTask g={game} send={send}/>}</section></>;
}
createRoot(document.getElementById('fixture-root')!).render(<Fixture/>);
