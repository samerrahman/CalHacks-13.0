import Phaser from 'phaser'
import { DeskScene } from './scenes/DeskScene.js'

/** @param {string} parent id of the DOM element to mount into */
export function startGame(parent) {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 1280,
    height: 720,
    backgroundColor: '#05060a',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [DeskScene],
  })
}
