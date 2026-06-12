import type { RoutePoint } from "@/types/domain";

export function normalizeAddress(address: string) {
  return address.replace(/\s+/g, "").trim();
}

export function mockGeocode(address: string) {
  const seed = Array.from(address).reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0,
  );

  return {
    lat: 35.62 + (seed % 900) / 10000,
    lng: 139.54 + (seed % 1200) / 10000,
    normalizedAddress: normalizeAddress(address),
  };
}

export function distanceMeters(a: RoutePoint, b: RoutePoint) {
  const earthRadiusMeters = 6371000;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const deltaLat = ((b.lat - a.lat) * Math.PI) / 180;
  const deltaLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const value =
    sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  const angle = 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));

  return earthRadiusMeters * angle;
}
