import { describe, expect, it } from "vitest";
import {
  findDuplicateCandidates,
  findVisitWarningsForLocations,
} from "@/lib/duplicates";
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

describe("duplicate warning helpers", () => {
  it("flags same-address constructed locations with high priority", () => {
    const candidates = findDuplicateCandidates(
      {
        customerName: "山田 太郎",
        address: "東京都世田谷区桜丘1-12-8",
        lat: 35.6427,
        lng: 139.6324,
      },
      [
        location({
          locationId: "loc-constructed",
          customerName: "山田 太郎",
          status: "constructed",
        }),
      ],
    );

    expect(candidates.map((candidate) => candidate.reason)).toEqual(
      expect.arrayContaining(["same_address", "nearby", "constructed"]),
    );
    expect(candidates[0].score).toBeGreaterThanOrEqual(80);
  });

  it("adds direct visit warnings and removes exact duplicates", () => {
    const warnings = findVisitWarningsForLocations(
      ["loc-ng", "loc-ng"],
      [
        location({
          locationId: "loc-ng",
          customerName: "高橋 美咲",
          status: "do_not_visit",
        }),
      ],
    );

    expect(warnings.filter((warning) => warning.reason === "do_not_visit")).toHaveLength(1);
    expect(warnings[0].message).toContain("訪問NG");
  });
});
