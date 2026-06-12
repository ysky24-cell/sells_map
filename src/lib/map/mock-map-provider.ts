import { mockGeocode } from "@/lib/geo";
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
}
