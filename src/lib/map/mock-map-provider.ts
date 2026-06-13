import { mockGeocode, mockReverseGeocode } from "@/lib/geo";
import type { GeocodingService, MapTileProvider } from "@/types/domain";

export class MockMapProvider implements MapTileProvider {
  getStyleUrl() {
    return "mock://sales-map-provider";
  }
}

export class MockGeocodingService implements GeocodingService {
  async geocode(address: string) {
    return mockGeocode(address);
  }

  async reverseGeocode(params: Parameters<GeocodingService["reverseGeocode"]>[0]) {
    return mockReverseGeocode(
      { lat: params.lat, lng: params.lng },
      params.nearbyLocations ?? [],
    );
  }
}
