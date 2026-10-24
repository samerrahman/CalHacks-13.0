import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types/bridge.js'

/** @type {import('../shared/types/bridge.js').ScaryBridge} */
const bridge = {
  director: {
    decide: (req) => ipcRenderer.invoke(IPC.directorDecide, req),
  },
  voice: {
    speak: (req) => ipcRenderer.invoke(IPC.voiceSpeak, req),
  },
  storage: {
    saveSession: (record) => ipcRenderer.invoke(IPC.saveSession, record),
    listSessions: () => ipcRenderer.invoke(IPC.listSessions),
    saveCheckIn: (checkIn) => ipcRenderer.invoke(IPC.saveCheckIn, checkIn),
    listCheckIns: () => ipcRenderer.invoke(IPC.listCheckIns),
  },
  signals: {
    onFrame: (cb) => {
      const handler = (_event, frame) => cb(frame)
      ipcRenderer.on(IPC.signalFrame, handler)
      return () => ipcRenderer.off(IPC.signalFrame, handler)
    },
  },
}

contextBridge.exposeInMainWorld('scary', bridge)
