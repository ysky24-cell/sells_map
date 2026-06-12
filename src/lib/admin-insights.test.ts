import { describe, expect, it } from "vitest";
import { buildAdminActionItems } from "@/lib/admin-insights";
import type { Location, VisitRecord } from "@/types/domain";

function location(overrides: Partial<Location>): Location {
  return {
    locationId: "loc-001",
    customerName: "山田 太郎",
    address: "東京都世田谷区桜丘 1-12-8",
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

const visitRecord: VisitRecord = {
  visitId: "visit-001",
  locationId: "loc-visited",
  userId: "sales-001",
  visitedAt: "2026-06-12T01:00:00.000Z",
  result: "visited",
  createdAt: "2026-06-12T01:00:00.000Z",
  updatedAt: "2026-06-12T01:00:00.000Z",
};

describe("admin insights", () => {
  it("prioritizes high-risk action items for admins", () => {
    const items = buildAdminActionItems(
      [
        location({ locationId: "loc-unassigned", assignedUserId: undefined }),
        location({
          locationId: "loc-ng",
          assignedUserId: "sales-001",
          status: "do_not_visit",
        }),
        location({
          locationId: "loc-overdue",
          assignedUserId: "sales-001",
          nextInspectionDate: "2026-06-01",
        }),
      ],
      [],
      "2026-06-13",
    );

    expect(items.slice(0, 2).map((item) => item.severity)).toEqual([
      "high",
      "high",
    ]);
    expect(items.map((item) => item.title)).toEqual(
      expect.arrayContaining(["担当者未割当", "訪問NG", "点検予定日超過"]),
    );
  });

  it("does not flag no-visit locations when records exist", () => {
    const items = buildAdminActionItems(
      [
        location({
          locationId: "loc-visited",
          assignedUserId: "sales-001",
          lastVisitDate: undefined,
        }),
      ],
      [visitRecord],
      "2026-06-13",
    );

    expect(items.map((item) => item.title)).not.toContain("訪問履歴なし");
  });
});
