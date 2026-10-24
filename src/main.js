// Renderer entry point — wires the pieces together. Owned by the integrator (James).
import { startGame } from './game/index.js'
import { startSignals } from './signals/index.js'
import { mountSignalOverlay } from './signals/debugOverlay.js'

startSignals()
mountSignalOverlay()
startGame('app')
