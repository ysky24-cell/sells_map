import { describe, expect, it } from "vitest";
import {
  csvToLocations,
  locationsToCsv,
  parseCsv,
} from "@/lib/csv/locations-csv";
import type { Location } from "@/types/domain";

const baseLocation: Location = {
  locationId: "loc-001",
  customerName: "山田 太郎",
  address: "東京都世田谷区桜丘 1-12-8",
  normalizedAddress: "東京都世田谷区桜丘1-12-8",
  lat: 35.6427,
  lng: 139.6324,
  status: "constructed",
  assignedUserId: "sales-001",
  areaId: "area-setagaya",
  municipalityId: "muni-setagaya",
  constructionDate: "2024-05-10",
  nextInspectionDate: "2026-07-15",
  memo: "床下点検済み, 次回説明",
  tags: ["定期点検", "施工済み"],
  createdBy: "admin-001",
  updatedBy: "admin-001",
  createdAt: "2026-06-01T09:00:00.000Z",
  updatedAt: "2026-06-03T10:30:00.000Z",
};

describe("locations CSV helpers", () => {
  it("quotes commas and parses quoted CSV cells", () => {
    const csv = locationsToCsv([baseLocation]);

    expect(csv).toContain('"床下点検済み, 次回説明"');
    expect(csv).toContain("areaId,municipalityId");
    expect(parseCsv(csv)[1]).toContain("床下点検済み, 次回説明");
  });

  it("imports address-only rows with mock geocoding and default status", () => {
    const imported = csvToLocations(
      [
        "customerName,address,status,tags",
        "鈴木 一郎,東京都調布市仙川町 3-2-1,unknown,再訪問;注意",
      ].join("\n"),
      "admin-001",
      "2026-06-13T00:00:00.000Z",
      () => "loc-test",
    );

    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({
      locationId: "loc-test",
      normalizedAddress: "東京都調布市仙川町3-2-1",
      status: "unvisited",
      tags: ["再訪問", "注意"],
      createdBy: "admin-001",
      updatedAt: "2026-06-13T00:00:00.000Z",
    });
    expect(Number.isFinite(imported[0].lat)).toBe(true);
    expect(Number.isFinite(imported[0].lng)).toBe(true);
  });
});
