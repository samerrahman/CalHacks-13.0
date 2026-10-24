import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerAiIpc } from '../src/ai/main/index.js'

// Built to dist-electron/, next to preload.mjs.
const here = path.dirname(fileURLToPath(import.meta.url))

// API keys for the main process only (never exposed to the renderer). This runs after
// all imports are evaluated, so modules must read process.env lazily.
try {
  process.loadEnvFile()
} catch {
  // no .env yet — AI features fall back to canned responses
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#000000',
    webPreferences: { preload: path.join(here, 'preload.mjs') },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(here, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  registerAiIpc(ipcMain)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
