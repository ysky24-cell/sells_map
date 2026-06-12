import { describe, expect, it } from "vitest";
import { MockRouteService, optimizeRoutePoints } from "@/lib/route/mock-route-service";
import type { RoutePoint } from "@/types/domain";

const start: RoutePoint = { id: "start", lat: 35.6, lng: 139.6, label: "出発" };
const near: RoutePoint = { id: "near", lat: 35.6005, lng: 139.6005, label: "近い地点" };
const far: RoutePoint = { id: "far", lat: 35.68, lng: 139.68, label: "遠い地点" };

describe("mock route optimization", () => {
  it("keeps the first point as the start and orders nearby points first", () => {
    const route = optimizeRoutePoints([start, far, near]);

    expect(route.orderedPointIds).toEqual(["start", "near", "far"]);
    expect(route.totalDistanceMeters).toBeGreaterThan(0);
    expect(route.polyline).toContain("139.600000,35.600000");
  });

  it("keeps an explicit end point at the end", async () => {
    const service = new MockRouteService();
    const route = await service.optimizeRoute({
      start,
      end: near,
      waypoints: [far],
      travelMode: "car",
    });

    expect(route.orderedPointIds).toEqual(["start", "far", "near"]);
  });
});
