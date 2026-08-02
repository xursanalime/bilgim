// Task 27.3 — Impossible travel detection / geographic anomaly.
export {
  GeoIpService,
  isPrivateIp,
  lookupFromHeader,
} from './geoip.service';
export type { GeoIpLookup } from './geoip.service';

export {
  ImpossibleTravelService,
  haversineDistanceKm,
} from './impossible-travel.service';
export type { ImpossibleTravelDecision } from './impossible-travel.service';
