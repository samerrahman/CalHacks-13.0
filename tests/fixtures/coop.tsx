import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import WirePuzzle from '../../src/ui/WirePuzzle';
import { CalmTask, ConduitTask, FaultTask, LocatePanel, LocateTerminal } from '../../src/ui/ThinkingTasks';
import { BookPage, type BookPageId } from '../../src/ui/CoopManual';
import { coopBook, wireCodes } from '../../src/game/book';
import { coopManual } from '../../src/game/coop';
import { config, createGame, dispatch, step } from '../../src/game/reducer';
import { beginStep, startStage } from '../../src/game/tasks';
import type { GameAction, GameState } from '../../src/game/state';
import '../../src/ui/style.css';
import '../../src/ui/survival.css';
import '../../src/ui/spectate.css';

// Test-only entry point: co-op states from the real reducer. #player-<step> is what the player sees, #friend-<step> the book page for it.
const PAGE: Record<string, BookPageId> = { faults: 'faults', wires: 'cables', routing: 'conduit', memory: 'signal', locate: 'radar', calm: 'breathing' };
type Which = 'faults' | 'wires' | 'routing' | 'memory' | 'locate' | 'calm';
const WHICH: Which[] = ['faults', 'wires', 'routing', 'memory', 'locate', 'calm'];
function build(which: Which): GameState {
  let s = createGame(17, 'coop'); s.creature.nextMoveAt = 1e6; s.blackout.nextAt = 1e6;
  if (which === 'memory') { startStage(s, 2); beginStep(s, 'memory'); while (s.tasks.memory.playing) s = step(s, .2); return dispatch(s, { type: 'input', value: s.tasks.memory.sequence[0]! }); }
  if (which === 'locate') { startStage(s, 3); s.tasks.step = 'locate'; s.tasks.locate = { marks: 1, required: config.tasks.locate.marks, lastMarkAt: -1000 }; s.station = 'cameras'; return s; }
  if (which === 'calm') { startStage(s, 4); s.tasks.step = 'calm'; s.tasks.calm = { progress: 4, required: config.tasks.calm.seconds, pacerStartedAt: s.time, holding: false, halfSeconds: config.tasks.calm.breathSeconds, phaseStartedAt: s.time - 1.2, inhale: true, personal: false }; return s; }
  while (!s.tasks.faults.active.length) s = step(s, .1);
  if (which === 'faults') return s;
  s.tasks.faults.completed = s.tasks.faults.required; s.tasks.faults.active = []; s.tasks.faults.spawned = s.tasks.faults.required; s.tasks.step = 'wires';
  if (which === 'wires') { for (let from = 0; from < 2; from++) s = dispatch(s, { type: 'wire', from, to: s.tasks.wires.targetOrder.indexOf(from) }); return s; }
  beginStep(s, 'routing');
  return s;
}
function read(): { view: 'player' | 'friend'; which: Which } {
  const [view, which] = location.hash.slice(1).split('-');
  return { view: view === 'friend' ? 'friend' : 'player', which: ((WHICH as string[]).includes(which ?? '') ? which : 'faults') as Which };
}
function Fixture() {
  const [{ view, which }, setRoute] = useState(read), [game, setGame] = useState(() => build(read().which));
  useEffect(() => { const follow = () => { setRoute(read()); setGame(build(read().which)); }; addEventListener('hashchange', follow); return () => removeEventListener('hashchange', follow); }, []);
  const send = (action: GameAction) => setGame(g => dispatch(g, action));
  const steps = <div className="fixture-steps">{(['player', 'friend'] as const).flatMap(v => WHICH.map(w => <button key={v + w} onClick={() => { location.hash = `${v}-${w}`; }}>{v} {w}</button>))}</div>;
  if (view === 'friend') return <>{steps}<main className="judge-page spectate-page"><div className="eyebrow">HUSH / SPECTATING · TEST FIXTURE</div>
    <section className="spectate-card coop-manual"><small>THE MANUAL · CO-OP <em>TEST FIXTURE · real reducer state</em></small><div className="coop-book"><div className="book-sheet"><BookPage id={PAGE[which]!} book={coopBook(game.seed)} live={{ metres: game.creature.linePosition * 5, calm: (coopManual(game) as never) ?? null }}/></div></div></section></main></>;
  return <>{steps}<section className="task-panel terminal-inspection" role="dialog" aria-label="Research terminal"><div className="eyebrow">RESEARCH 01 / 04 · CO-OP · TEST FIXTURE</div>
    {which === 'wires' ? <WirePuzzle wires={game.tasks.wires} connect={(from, to) => send({ type: 'wire', from, to })} coop codes={panel => wireCodes(game.seed, game.tasks.stage, panel)}/> : which === 'routing' ? <ConduitTask g={game} send={send}/> : which === 'locate' ? <><LocateTerminal g={game}/><LocatePanel g={game} send={send}/></> : which === 'calm' ? <CalmTask g={game} send={send}/> : which === 'memory' ? <p>The memory panel lives in the HUD; see the friend page.</p> : <FaultTask g={game} send={send}/>}</section></>;
}
createRoot(document.getElementById('fixture-root')!).render(<Fixture/>);
