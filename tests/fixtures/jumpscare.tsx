import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import JumpScare from '../../src/ui/JumpScare';
import '../../src/ui/style.css';

// Test-only entry point: renders the real overlay over a placeholder scene. No game, audio or camera.
type Kind = 'impact' | 'monitor' | 'breach';
function ScareFixture() {
  const [scare, setScare] = useState<{ id: number; kind: Kind } | null>(null);
  const [soft, setSoft] = useState(false), [reduced, setReduced] = useState(false);
  const fire = (kind: Kind) => setScare(value => ({ id: (value?.id ?? 0) + 1, kind }));
  return <><div className="scene"/><JumpScare scare={scare} soft={soft} reduced={reduced}/>
    <div className="fixture-actions">{(['impact', 'monitor', 'breach'] as Kind[]).map(kind => <button key={kind} onClick={() => fire(kind)}>Fire {kind}</button>)}
      <label><input type="checkbox" checked={soft} onChange={e => setSoft(e.target.checked)}/> Softer</label>
      <label><input type="checkbox" checked={reduced} onChange={e => setReduced(e.target.checked)}/> Reduced motion</label></div></>;
}
createRoot(document.getElementById('fixture-root')!).render(<ScareFixture/>);
