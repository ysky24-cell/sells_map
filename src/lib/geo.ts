import type { RoutePoint } from "@/types/domain";
import type { Location } from "@/types/domain";

type GeoPoint = RoutePoint | { lat: number; lng: number };

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

function approximateTownFromAddress(address: string) {
  const compactAddress = normalizeAddress(address);
  const town = compactAddress.replace(/[0-9０-９].*$/, "");
  return town || compactAddress;
}

function estimateAreaName(point: { lat: number; lng: number }) {
  if (point.lng < 139.57) return "東京都調布市・三鷹市境界付近";
  if (point.lng < 139.6) return "東京都三鷹市付近";
  if (point.lat > 35.69) return "東京都杉並区付近";
  if (point.lat < 35.65) return "東京都世田谷区南部付近";
  return "東京都世田谷区・杉並区周辺";
}

export function mockReverseGeocode(
  point: { lat: number; lng: number },
  nearbyLocations: Location[] = [],
) {
  const sortedLocations = [...nearbyLocations]
    .filter(
      (location) =>
        Number.isFinite(location.lat) &&
        Number.isFinite(location.lng) &&
        Boolean(location.address),
    )
    .map((location) => ({
      location,
      distance: distanceMeters(point, location),
    }))
    .sort((a, b) => a.distance - b.distance);
  const nearest = sortedLocations[0];

  if (nearest && nearest.distance <= 700) {
    const town = approximateTownFromAddress(nearest.location.address);
    const address = `${town}付近（地図選択・番地要確認）`;
    return {
      address,
      normalizedAddress: normalizeAddress(address),
      confidence: "nearby_location" as const,
      sourceLocationId: nearest.location.locationId,
    };
  }

  const area = estimateAreaName(point);
  const address = `${area} ${point.lat.toFixed(5)}, ${point.lng.toFixed(
    5,
  )}付近（地図選択・番地要確認）`;
  return {
    address,
    normalizedAddress: normalizeAddress(address),
    confidence: sortedLocations.length > 0 ? ("area" as const) : ("coordinate" as const),
    sourceLocationId: nearest?.location.locationId,
  };
}

export function distanceMeters(a: GeoPoint, b: GeoPoint) {
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
