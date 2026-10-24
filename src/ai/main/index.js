// Runs in the Electron main process, where the API keys live.
import { IPC } from '../../../shared/types/bridge.js'
import { cannedDecide } from './canned.js'

/** @param {import('electron').IpcMain} ipcMain */
export function registerAiIpc(ipcMain) {
  ipcMain.handle(IPC.directorDecide, (_event, req) => cannedDecide(req))
  // Cartesia goes here. null tells the game to show subtitles without audio.
  ipcMain.handle(IPC.voiceSpeak, () => null)
}
