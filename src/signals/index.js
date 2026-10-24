import { startMockSignals } from './mock.js'

export { signalBus } from './bus.js'
export { startMockSignals, MOCK_KEYS } from './mock.js'

/**
 * Start the configured signal source. Mock for now; Presage and replay plug in here
 * and publish to the same signalBus.
 * @returns {() => void} stop
 */
export function startSignals() {
  return startMockSignals()
}
