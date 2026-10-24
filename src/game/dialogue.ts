import source from '../../night-relay-kit/design/dialogue.json';

type SafeLineId = 'mara_intro' | 'mara_power' | 'mara_sweep' | 'mara_recover' | 'mara_complete';

function authored(id: SafeLineId): string {
  const line = source.lines.find(candidate => candidate.id === id);
  if (!line || line.templateOnly || line.actualSpeaker !== 'boss' || line.displaySpeaker !== 'RADIO' || line.text.length > 300) {
    throw new Error(`Missing or unsafe authored supervisor line: ${id}`);
  }
  return line.text;
}

/** Only invariant, non-template lines are reused. Operative orders and private
 * authentication responses are always composed by the local game authority. */
export const MARA_DIALOGUE = Object.freeze({
  intro: authored('mara_intro'),
  power: authored('mara_power'),
  sweep: authored('mara_sweep'),
  recover: authored('mara_recover'),
  complete: authored('mara_complete'),
});
