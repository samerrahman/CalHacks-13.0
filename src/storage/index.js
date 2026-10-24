// Runs in the renderer. Convex needs only the public deployment URL, never a secret.
import { ConvexClient } from 'convex/browser'

/** @typedef {'not configured'|'connecting'|'connected'} ConvexStatus */

/** @type {ConvexClient | null | undefined} */
let client

/** Convex client, or null when VITE_CONVEX_URL isn't set (the game runs offline). */
export function getConvex() {
  if (client === undefined) {
    const url = import.meta.env.VITE_CONVEX_URL
    // The default beforeunload warning silently blocks Electron windows from closing.
    client = url ? new ConvexClient(url, { unsavedChangesWarning: false }) : null
  }
  return client
}

/**
 * Reports the connection state now and on every change.
 * @param {(status: ConvexStatus) => void} cb
 * @returns {() => void} unsubscribe
 */
export function watchConvex(cb) {
  const convex = getConvex()
  if (!convex) {
    cb('not configured')
    return () => {}
  }
  /** @param {{ isWebSocketConnected: boolean }} state */
  const report = (state) => cb(state.isWebSocketConnected ? 'connected' : 'connecting')
  report(convex.connectionState())
  return convex.subscribeToConnectionState(report)
}
