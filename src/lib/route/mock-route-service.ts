import { distanceMeters } from "@/lib/geo";
import type { OptimizedRoute, RoutePoint, RouteService } from "@/types/domain";

export function optimizeRoutePoints(points: RoutePoint[]): OptimizedRoute {
  const [start, ...rest] = points;
  const ordered = [start];
  const remaining = [...rest];
  let current = start;

  while (remaining.length > 0) {
    let nextIndex = 0;
    let nextDistance = Number.POSITIVE_INFINITY;

    remaining.forEach((point, index) => {
      const distance = distanceMeters(current, point);
      if (distance < nextDistance) {
        nextDistance = distance;
        nextIndex = index;
      }
    });

    const [next] = remaining.splice(nextIndex, 1);
    ordered.push(next);
    current = next;
  }

  const totalDistanceMeters = ordered.reduce((sum, point, index) => {
    const previous = ordered[index - 1];
    return previous ? sum + distanceMeters(previous, point) : sum;
  }, 0);

  return {
    orderedPointIds: ordered.map((point) => point.id),
    totalDistanceMeters: Math.round(totalDistanceMeters),
    totalDurationSeconds: Math.round(totalDistanceMeters / 1000 / 25 * 3600),
    polyline: ordered
      .map((point) => `${point.lng.toFixed(6)},${point.lat.toFixed(6)}`)
      .join(";"),
  };
}

export class MockRouteService implements RouteService {
  async optimizeRoute(params: {
    start: RoutePoint;
    end?: RoutePoint;
    waypoints: RoutePoint[];
    travelMode: "car";
  }): Promise<OptimizedRoute> {
    const optimized = optimizeRoutePoints([params.start, ...params.waypoints]);
    if (!params.end) return optimized;

    const pointById = new Map(
      [params.start, ...params.waypoints, params.end].map((point) => [
        point.id,
        point,
      ]),
    );
    const orderedPoints = [
      ...optimized.orderedPointIds
        .map((pointId) => pointById.get(pointId))
        .filter((point): point is RoutePoint => Boolean(point)),
      params.end,
    ];
    const totalDistanceMeters = orderedPoints.reduce((sum, point, index) => {
      const previous = orderedPoints[index - 1];
      return previous ? sum + distanceMeters(previous, point) : sum;
    }, 0);

    return {
      orderedPointIds: orderedPoints.map((point) => point.id),
      totalDistanceMeters: Math.round(totalDistanceMeters),
      totalDurationSeconds: Math.round(totalDistanceMeters / 1000 / 25 * 3600),
      polyline: orderedPoints
        .map((point) => `${point.lng.toFixed(6)},${point.lat.toFixed(6)}`)
        .join(";"),
    };
  }
}

export const routeService = new MockRouteService();
