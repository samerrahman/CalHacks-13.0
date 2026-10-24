// Runs in the Electron main process.
import { IPC } from '../../shared/types/bridge.js'

/** @typedef {import('../../shared/types/storage.js').SessionRecord} SessionRecord */
/** @typedef {import('../../shared/types/storage.js').CheckIn} CheckIn */

// In-memory placeholder so the bridge works today. Swap for SQLite; keep the IPC surface.
/** @type {Map<string, SessionRecord>} */
const sessions = new Map()
/** @type {CheckIn[]} */
const checkIns = []

/** @param {import('electron').IpcMain} ipcMain */
export function registerStorageIpc(ipcMain) {
  ipcMain.handle(IPC.saveSession, (_event, /** @type {SessionRecord} */ record) => {
    sessions.set(record.id, record)
  })
  ipcMain.handle(IPC.listSessions, () => [...sessions.values()])
  ipcMain.handle(IPC.saveCheckIn, (_event, /** @type {CheckIn} */ checkIn) => {
    checkIns.push(checkIn)
  })
  ipcMain.handle(IPC.listCheckIns, () => checkIns)
}
