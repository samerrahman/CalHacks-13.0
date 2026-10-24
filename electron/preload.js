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
  signals: {
    onFrame: (cb) => {
      const handler = (_event, frame) => cb(frame)
      ipcRenderer.on(IPC.signalFrame, handler)
      return () => ipcRenderer.off(IPC.signalFrame, handler)
    },
  },
}

contextBridge.exposeInMainWorld('scary', bridge)
