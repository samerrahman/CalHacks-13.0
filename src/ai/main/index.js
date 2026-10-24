// Runs in the Electron main process, where the API keys live.
import { IPC } from '../../../shared/types/bridge.js'
import { cannedDecide } from './canned.js'
import { cartesiaVoice, getCartesia } from './cartesia.js'
import { geminiModel, getGemini } from './gemini.js'

/** @param {import('electron').IpcMain} ipcMain */
export function registerAiIpc(ipcMain) {
  const gemini = getGemini() && geminiModel() ? `gemini (${geminiModel()})` : 'canned (no GEMINI_API_KEY/GEMINI_MODEL)'
  const voice = getCartesia() && cartesiaVoice().voiceId ? 'cartesia' : 'subtitles only (no CARTESIA_API_KEY/CARTESIA_VOICE_ID)'
  console.log(`[ai] director: ${gemini} · voice: ${voice}`)

  // Gemini goes here; keep cannedDecide as the fallback for every failure.
  ipcMain.handle(IPC.directorDecide, (_event, req) => cannedDecide(req))
  // Cartesia goes here. null tells the game to show subtitles without audio.
  ipcMain.handle(IPC.voiceSpeak, () => null)
}
