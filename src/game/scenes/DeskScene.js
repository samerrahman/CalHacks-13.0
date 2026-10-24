import Phaser from 'phaser'
import { DIRECTOR_MENU } from '../../../shared/types/director.js'
import { signalBus } from '../../signals/index.js'

/** @typedef {import('../../../shared/types/director.js').DirectorRequest} DirectorRequest */

const DIRECTOR_INTERVAL_MS = 8000

// Placeholder desk: rectangles until real art lands in assets/asset-pack.json.
export class DeskScene extends Phaser.Scene {
  constructor() {
    super('desk')
    this.nightStartedAt = Date.now()
  }

  preload() {
    this.load.pack('main', 'asset-pack.json')
  }

  create() {
    const { width, height } = this.scale

    this.add.rectangle(width / 2, height - 120, width * 0.8, 160, 0x2a1d14) // desk
    this.lampGlow = this.add.circle(width * 0.25, height - 260, 140, 0xffd27a, 0.12)
    this.add.rectangle(width * 0.25, height - 230, 24, 60, 0x6b5a3a) // lamp
    this.add.rectangle(width * 0.7, height - 225, 120, 50, 0x3a3a3a) // radio

    this.status = this.add
      .text(width - 16, 16, 'director: waiting…', { fontFamily: 'monospace', fontSize: '14px', color: '#c9b' })
      .setOrigin(1, 0)

    this.time.addEvent({ delay: DIRECTOR_INTERVAL_MS, loop: true, callback: () => this.askDirector() })
  }

  update() {
    // Lamp glow breathes with the player — proves signals reach the game loop.
    const frame = signalBus.latest()
    if (frame) this.lampGlow.setAlpha(0.1 + 0.06 * (frame.breath + 1))
  }

  async askDirector() {
    const frame = signalBus.latest()
    /** @type {DirectorRequest} */
    const req = {
      night: 1,
      elapsedMs: Date.now() - this.nightStartedAt,
      player: {
        pulseBpm: frame?.pulseBpm ?? null,
        baselinePulseBpm: frame?.baselinePulseBpm ?? null,
        fear: frame?.fear ?? 0,
        breathRate: frame?.breathRate ?? null,
        blinksPerMin: 0,
        talkingRatio: 0,
        faceDetected: frame?.faceDetected ?? false,
      },
      resources: { lampOn: true, radioOn: false, oil: 1 },
      activeCreatures: [],
      recentEvents: [],
      menu: [...DIRECTOR_MENU],
    }
    const res = await window.scary.director.decide(req)
    this.status.setText(`director: ${res.event} (${res.source}) — ${res.reason}`)
    if (res.event === 'lamp_flicker') this.cameras.main.flash(120, 0, 0, 0)
  }
}
