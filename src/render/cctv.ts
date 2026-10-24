export type CameraFeed = 'A' | 'B' | 'C';
export type WorldPosition = [number, number, number];
const COVERAGE: Record<CameraFeed, { start: WorldPosition; end: WorldPosition; anchors: [number, number][] }> = {
  A: { start: [0, 0, -26], end: [-16, 0, -34], anchors: [[.79, .71], [.53, .58], [.37, .52]] },
  B: { start: [0, 0, -26], end: [14, 0, -46], anchors: [[.54, .78], [.56, .59], [.64, .42]] },
  C: { start: [14, 0, -46], end: [14, 0, -62], anchors: [[.49, .82], [.58, .57], [.59, .34]] },
};
/** Only actual positions on this feed's graph edge get a silhouette. */
export function projectCreature(feed: CameraFeed, position: WorldPosition, sealed = false): { x: number; y: number; scale: number; progress: number } | null {
  if (sealed || position.some(value => !Number.isFinite(value))) return null;
  const { start, end, anchors } = COVERAGE[feed];
  const dx = end[0] - start[0], dz = end[2] - start[2];
  const t = ((position[0] - start[0]) * dx + (position[2] - start[2]) * dz) / (dx * dx + dz * dz);
  if (t < -.001 || t > 1.001) return null;
  const progress = Math.max(0, Math.min(1, t));
  const offset = Math.hypot(position[0] - start[0] - progress * dx, position[2] - start[2] - progress * dz);
  if (offset > .45 || Math.abs(position[1]) > .5) return null;
  const part = progress < .5 ? 0 : 1, blend = (progress - part * .5) * 2;
  return { x: anchors[part]![0] + (anchors[part + 1]![0] - anchors[part]![0]) * blend,
    y: anchors[part]![1] + (anchors[part + 1]![1] - anchors[part]![1]) * blend,
    scale: .074 - progress * .035, progress };
}
