// Types window.scary for checkJs. The only .d.ts in the repo.
import type { ScaryBridge } from './bridge.js'

declare global {
  interface Window {
    scary: ScaryBridge
  }
}

export {}
