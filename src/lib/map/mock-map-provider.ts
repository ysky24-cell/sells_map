import type { GeocodingService, MapTileProvider } from "@/types/domain";

export class MockMapProvider implements MapTileProvider {
  getStyleUrl() {
    return "mock://sales-map-provider";
  }
}

export class MockGeocodingService implements GeocodingService {
  async geocode(address: string) {
    const seed = Array.from(address).reduce(
      (sum, char) => sum + char.charCodeAt(0),
      0,
    );

    return {
      lat: 35.62 + (seed % 900) / 10000,
      lng: 139.54 + (seed % 1200) / 10000,
      normalizedAddress: address.replace(/\s+/g, ""),
    };
  }
}
