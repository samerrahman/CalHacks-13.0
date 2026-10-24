// CONTRACT — changes need team approval in chat first.
// The renderer (game, UI) talks to the Electron main process (API keys, SQLite, Presage)
// only through window.scary, which electron/preload.js builds from these channels.

export const IPC = {
  directorDecide: 'director:decide',
  voiceSpeak: 'voice:speak',
  saveSession: 'storage:saveSession',
  listSessions: 'storage:listSessions',
  saveCheckIn: 'storage:saveCheckIn',
  listCheckIns: 'storage:listCheckIns',
  signalFrame: 'signals:frame',
}

/**
 * @typedef {Object} VoiceRequest
 * @property {string} text
 * @property {'mimic'|'narrator'} voice
 */

/**
 * @typedef {Object} ScaryBridge
 * @property {{ decide(req: import('./director.js').DirectorRequest): Promise<import('./director.js').DirectorResponse> }} director
 * @property {{ speak(req: VoiceRequest): Promise<ArrayBuffer|null> }} voice   null = no audio, show subtitles only
 * @property {{
 *   saveSession(record: import('./storage.js').SessionRecord): Promise<void>,
 *   listSessions(): Promise<import('./storage.js').SessionRecord[]>,
 *   saveCheckIn(checkIn: import('./storage.js').CheckIn): Promise<void>,
 *   listCheckIns(): Promise<import('./storage.js').CheckIn[]>,
 * }} storage
 * @property {{ onFrame(cb: (frame: import('./signals.js').SignalFrame) => void): () => void }} signals   frames pushed from main (Presage)
 */
