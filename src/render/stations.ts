import { Vector3 } from 'three';

export type Station = 'terminal' | 'cameras' | 'equipment';

export const STATION_ORDER: Station[] = ['terminal', 'cameras', 'equipment'];
export const STATION_TARGETS: Record<Station, Vector3> = {
  terminal: new Vector3(.05, 1.42, -1.8),
  cameras: new Vector3(.73, 1.37, -1.64),
  equipment: new Vector3(-.85, 1.38, 2.39),
};

export function nextStation(current: Station, direction: number): Station {
  return STATION_ORDER[(STATION_ORDER.indexOf(current) + direction + STATION_ORDER.length) % STATION_ORDER.length]!;
}
