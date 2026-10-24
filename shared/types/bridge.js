// CONTRACT — changes need team approval in chat first.
// The renderer (game, UI) reaches main-process things (API keys, Presage) only through
// window.scary, which electron/preload.js builds from these channels. Convex is not on
// the bridge: the renderer talks to it directly through src/storage.

export const IPC = {
  directorDecide: 'director:decide',
  voiceSpeak: 'voice:speak',
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
 * @property {{ onFrame(cb: (frame: import('./signals.js').SignalFrame) => void): () => void }} signals   frames pushed from main (Presage)
 */
