import { useState } from 'react';
import { clearCheckIn, loadCheckIn, saveCheckIn, type Feeling } from './storage';
import './wellness.css';

const CHOICES: Feeling[] = ['Calm', 'Mixed', 'Tense'];
const STORAGE_NOTICE = 'Local storage is unavailable. Your answer could not be saved.';

export default function WellnessCheckIn() {
  const [saved, setSaved] = useState(loadCheckIn);
  const [notice, setNotice] = useState(saved.available ? '' : STORAGE_NOTICE);

  function choose(choice: Feeling) {
    const entry = saveCheckIn(choice);
    if (entry) {
      setSaved({ entry, available: true });
      setNotice('');
    } else {
      setNotice(STORAGE_NOTICE);
    }
  }

  function clear() {
    if (clearCheckIn()) {
      setSaved({ entry: null, available: true });
      setNotice('');
    } else {
      setNotice('Local storage is unavailable. Your saved answer could not be cleared.');
    }
  }

  return <section className="wellness-checkin" aria-label="Optional wellness check-in">
    <div className="wellness-checkin__label">OPTIONAL CHECK-IN · SELF-REPORTED</div>
    <fieldset>
      <legend>How do you feel right now?</legend>
      <div className="wellness-checkin__choices">
        {CHOICES.map(choice => <button key={choice} type="button" aria-pressed={saved.entry?.choice === choice} onClick={() => choose(choice)}>{choice}</button>)}
      </div>
    </fieldset>
    {saved.entry && <div className="wellness-checkin__saved">
      <span>Saved: {saved.entry.choice} · <time dateTime={saved.entry.timestamp}>{new Date(saved.entry.timestamp).toLocaleString()}</time></span>
      <button type="button" onClick={clear}>Clear answer</button>
    </div>}
    <p>Your answer is self-reported, saved in this browser, and does not affect the game.</p>
    {notice && <p className="wellness-checkin__notice" role="status">{notice}</p>}
  </section>;
}
