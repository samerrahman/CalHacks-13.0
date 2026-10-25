import type { PublicEvent } from '../game/state';
import type { Highlight } from './highlights';

/** A spectator narrator: short written lines filled in from the public trace and the shared whole-BPM
 * heart rate, spoken by the browser's own speech synthesis (no provider key, nothing sent anywhere) and
 * always shown as a caption. Off until the spectator turns it on. */
export type NarrationContext = { bpm: number | null; metres: number | null; locks: number; equipment: string };
export type Narration = { id: string; text: string; priority: number };

const pulse = (c: NarrationContext) => c.bpm ? ` Pulse ${c.bpm}.` : '';
/** The line for a public event, or null if it is not worth a line. Priority: higher interrupts lower. */
export function narrateEvent(e: PublicEvent, c: NarrationContext): Narration | null {
  const line = (text: string, priority = 1): Narration => ({ id: e.id, text, priority });
  switch (e.type) {
    case 'RUN_STARTED': return line('They are in the shelter. Four locks between them and the basement.');
    case 'PROXIMITY_ALARM': return line(`It is at the wall.${pulse(c)} They can only hear it.`, 2);
    case 'QUIET_ENTERED': return line(c.metres !== null && c.metres <= 12 ? 'They killed the power. Now they wait in the dark.' : 'Equipment off. They are listening.');
    case 'RESTORED': return line('Power is back. The machines are loud again.');
    case 'SCARE': return e.detail === 'breach' ? line('It is through.', 3) : line(`Something hit the door.${pulse(c)}`, 2);
    case 'ATTACK_COMMITTED': return line('It is coming through the door.', 3);
    case 'WRONG_INPUT': return line('A mistake. That was loud.');
    case 'TASK_COMPLETE': { const left = Math.max(0, 4 - c.locks); return line(left ? `Lock released. ${left} to go.` : 'All four locks are open.'); }
    case 'LURE_TRANSMITTED': return line('A decoy heartbeat, out in the trees. Will it follow?');
    case 'BLACKOUT_STARTED': return line('The lights just died.', 2);
    case 'FINAL_BROADCAST': return line('The last decoy. The door motor is starting, and it is loud.', 2);
    case 'VOICE_HEARD': return line('Too loud. It heard them talking.', 2);
    case 'FRIEND_WARNING': return line('You warned them.');
    case 'FRIEND_DECOY': return line('Your decoy fired. Watch the distance.');
    case 'WON': return line('They made it into the basement.', 3);
    case 'LOST': return line('The shelter has gone quiet.', 3);
    default: return null;
  }
}
export function narrateHighlight(h: Highlight): Narration | null {
  if (h.kind === 'close-call') return { id: h.id, text: 'That was close.', priority: 2 };
  if (h.kind === 'left-wall') return { id: h.id, text: 'It is walking away. For now.', priority: 1 };
  if (h.kind === 'spike') return { id: h.id, text: `${h.text.replace(/ BPM.*/, '').replace('Heart rate', 'Their heart rate went from').replace('→', 'to')}.`, priority: 2 };
  if (h.kind === 'steadied') return { id: h.id, text: 'They calmed down, and it lost them.', priority: 2 };
  return null;
}

/** Speaks one line at a time, at most one every few seconds; a higher-priority line cuts in. */
export class Narrator {
  private speaking: Narration | null = null;
  private lastAt = -Infinity;
  private said = new Set<string>();
  private voice: SpeechSynthesisVoice | null = null;
  constructor(private readonly onCaption: (text: string | null) => void, private readonly gapMs = 5000) {
    const pick = () => {
      const voices = typeof speechSynthesis === 'undefined' ? [] : speechSynthesis.getVoices();
      this.voice = voices.find(v => /en-GB/i.test(v.lang) && /male|daniel|arthur/i.test(v.name)) ?? voices.find(v => /^en/i.test(v.lang)) ?? null;
    };
    pick(); if (typeof speechSynthesis !== 'undefined') speechSynthesis.addEventListener?.('voiceschanged', pick);
  }
  static get available(): boolean { return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined'; }
  /** Lines already in the trace when the narrator starts are marked said, so it never replays history. */
  skip(ids: Iterable<string>): void { for (const id of ids) this.said.add(id); }
  say(line: Narration | null, now = performance.now()): void {
    if (!line || this.said.has(line.id)) return;
    this.said.add(line.id);
    const busy = this.speaking !== null;
    if ((busy && line.priority <= this.speaking!.priority) || (!busy && now - this.lastAt < this.gapMs && line.priority < 3)) return;
    if (!Narrator.available) { this.caption(line, now); return; }
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(line.text);
    if (this.voice) utterance.voice = this.voice;
    utterance.rate = 0.92; utterance.pitch = 0.75; utterance.volume = 0.9;
    const done = () => { if (this.speaking === line) { this.speaking = null; this.onCaption(null); } };
    utterance.onend = done; utterance.onerror = done;
    this.speaking = line; this.lastAt = now; this.onCaption(line.text);
    speechSynthesis.speak(utterance);
  }
  private caption(line: Narration, now: number): void {
    this.lastAt = now; this.onCaption(line.text);
    setTimeout(() => this.onCaption(null), 3500);
  }
  stop(): void { if (Narrator.available) speechSynthesis.cancel(); this.speaking = null; this.onCaption(null); }
}
