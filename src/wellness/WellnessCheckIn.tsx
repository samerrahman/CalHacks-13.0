import { useState } from 'react';
import { appendCheckIn, clearJournal, loadJournal, type Feeling } from './storage';
import './wellness.css';

const CHOICES: Feeling[] = ['Calm', 'Mixed', 'Tense'];
const SUGGESTIONS: Record<Feeling, string> = {
  Calm: 'If you like, carry this quiet moment into your next shift.',
  Mixed: 'You can take a moment before choosing what to do next.',
  Tense: 'A short break or lower volume may make the next shift more comfortable.',
};
const STORAGE_NOTICE = 'Local storage is unavailable. Your answer could not be saved.';

export default function WellnessCheckIn({ onChange }: { onChange?: (choice: Feeling | null) => void }) {
  const [journal, setJournal] = useState(loadJournal);
  const [notice, setNotice] = useState(journal.available ? '' : STORAGE_NOTICE);
  const latest = journal.entries[0];

  function choose(choice: Feeling) {
    const next = appendCheckIn(choice);
    if (next) {
      setJournal(next);
      setNotice('');
      onChange?.(choice);
    } else {
      setNotice(STORAGE_NOTICE);
    }
  }

  function clear() {
    if (clearJournal()) {
      setJournal({ entries: [], available: true });
      setNotice('');
      onChange?.(null);
    } else {
      setNotice('Local storage is unavailable. Your journal could not be cleared.');
    }
  }

  return <section className="wellness-checkin" aria-label="Optional wellness journal">
    <div className="wellness-checkin__label">OPTIONAL JOURNAL · SELF-REPORTED</div>
    <fieldset>
      <legend>How do you feel right now?</legend>
      <div className="wellness-checkin__choices">
        {CHOICES.map(choice => <button key={choice} type="button" aria-pressed={latest?.choice === choice} onClick={() => choose(choice)}>{choice}</button>)}
      </div>
    </fieldset>
    {latest && <>
      <p className="wellness-checkin__suggestion">{SUGGESTIONS[latest.choice]}</p>
      <div className="wellness-checkin__saved">
        <span>Latest: {latest.choice} · <time dateTime={latest.timestamp}>{new Date(latest.timestamp).toLocaleString()}</time></span>
        <button type="button" onClick={clear}>Clear journal</button>
      </div>
      <details className="wellness-checkin__history">
        <summary>Recent answers ({journal.entries.length})</summary>
        <ol>{journal.entries.map((entry, index) => <li key={`${entry.timestamp}-${index}`}>
          <span>{entry.choice}</span> · <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleString()}</time>
        </li>)}</ol>
      </details>
    </>}
    <p>Your answers are self-reported, saved only in this browser, and do not affect the game.</p>
    {notice && <p className="wellness-checkin__notice" role="status">{notice}</p>}
  </section>;
}
