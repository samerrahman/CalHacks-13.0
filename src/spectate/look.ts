/** A fixed CCTV mount can turn while held, then return with a critically damped spring. */
export class SpringLook {
  yaw = 0;
  pitch = 0;
  private yawVelocity = 0;
  private pitchVelocity = 0;
  private held = false;
  begin(): void { this.held = true; this.yawVelocity = this.pitchVelocity = 0; }
  drag(dx: number, dy: number): void {
    if (!this.held || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.yaw = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, this.yaw - dx));
    this.pitch = Math.max(-Math.PI / 6, Math.min(Math.PI / 6, this.pitch - dy));
  }
  release(): void { this.held = false; }
  reset(): void { this.held = false; this.yaw = this.pitch = this.yawVelocity = this.pitchVelocity = 0; }
  step(dt: number, reducedMotion = false): void {
    if (this.held) return;
    if (reducedMotion) { this.reset(); return; }
    if (!Number.isFinite(dt) || dt <= 0) return;
    const spring = (position: number, velocity: number): [number, number] => {
      const omega = 12, c = velocity + omega * position, decay = Math.exp(-omega * dt);
      const p = (position + c * dt) * decay, v = (velocity - omega * c * dt) * decay;
      return Math.abs(p) + Math.abs(v) < .0001 ? [0, 0] : [p, v];
    };
    [this.yaw, this.yawVelocity] = spring(this.yaw, this.yawVelocity);
    [this.pitch, this.pitchVelocity] = spring(this.pitch, this.pitchVelocity);
  }
}
