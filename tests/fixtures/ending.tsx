import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import OpeningFilm from '../../src/ui/OpeningFilm';
import { FILM as ENDING, captionAt as endingCaptionAt } from '../../src/cutscene/ending';
import '../../src/ui/style.css';

// Test-only entry point: the ending film exactly as App mounts it after a win, over a placeholder scene.
function EndingFixture() {
  const [state, setState] = useState<'film' | 'done' | 'failed'>('film');
  return <><div className="scene"/>
    {state === 'film' && <OpeningFilm video={`/${ENDING.video}`} captionOf={endingCaptionAt} label="Ending cutscene" className="ending-film" muted volume={0.45} onDone={() => setState('done')} onFail={() => setState('failed')}/>}
    {state !== 'film' && <output className="fixture-done" data-testid="ending-state">{state === 'done' ? 'Ending finished: run report would show' : 'Ending failed: text cards would show'}</output>}</>;
}
createRoot(document.getElementById('fixture-root')!).render(<EndingFixture/>);
