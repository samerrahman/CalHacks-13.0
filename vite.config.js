import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'

export default defineConfig({
  // Files in /assets are served at the web root, so `assets/sprites/watcher_idle.png`
  // loads as `sprites/watcher_idle.png`. Art swaps in without code changes.
  publicDir: 'assets',
  build: { chunkSizeWarningLimit: 2000 }, // three.js alone is ~700 kB
  plugins: [
    electron({
      main: { entry: 'electron/main.js' },
      preload: { input: 'electron/preload.js' },
    }),
  ],
})
