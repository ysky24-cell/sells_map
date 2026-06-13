import { describe, expect, it } from "vitest";
import { mockReverseGeocode, normalizeAddress } from "@/lib/geo";
import type { Location } from "@/types/domain";

function location(overrides: Partial<Location>): Location {
  return {
    locationId: "loc-base",
    customerName: "基準 顧客",
    address: "東京都世田谷区桜丘 1-12-8",
    normalizedAddress: "東京都世田谷区桜丘1-12-8",
    lat: 35.6427,
    lng: 139.6324,
    status: "unvisited",
    createdBy: "admin-001",
    updatedBy: "admin-001",
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
    ...overrides,
  };
}

describe("mock geocoding helpers", () => {
  it("normalizes whitespace from addresses", () => {
    expect(normalizeAddress("東京都 世田谷区 桜丘 1-12-8")).toBe(
      "東京都世田谷区桜丘1-12-8",
    );
  });

  it("returns an approximate address from a nearby map point", () => {
    const result = mockReverseGeocode(
      { lat: 35.64272, lng: 139.63245 },
      [location({ locationId: "loc-near" })],
    );

    expect(result.confidence).toBe("nearby_location");
    expect(result.sourceLocationId).toBe("loc-near");
    expect(result.address).toContain("東京都世田谷区桜丘");
    expect(result.address).toContain("番地要確認");
  });

  it("falls back to an area address when no nearby point exists", () => {
    const result = mockReverseGeocode({ lat: 35.7, lng: 139.56 });

    expect(result.confidence).toBe("coordinate");
    expect(result.address).toContain("付近");
    expect(result.address).toContain("番地要確認");
  });
});
