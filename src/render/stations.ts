import { Vector3 } from 'three';

export type Station = 'console' | 'left' | 'right' | 'relay';

export const STATION_ORDER: Station[] = ['console', 'left', 'relay', 'right'];
export const STATION_TARGETS: Record<Station, Vector3> = {
  console: new Vector3(0, 1.48, -2.7),
  left: new Vector3(-6, 1.35, 0),
  right: new Vector3(6, 1.35, 0),
  relay: new Vector3(0, 1.46, 2.65),
};

export function nextStation(current: Station, direction: number): Station {
  return STATION_ORDER[(STATION_ORDER.indexOf(current) + direction + 4) % 4]!;
}
