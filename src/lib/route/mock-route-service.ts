import type { OptimizedRoute, RoutePoint, RouteService } from "@/types/domain";

function distanceMeters(a: RoutePoint, b: RoutePoint) {
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

export class MockRouteService implements RouteService {
  async optimizeRoute(params: {
    start: RoutePoint;
    end?: RoutePoint;
    waypoints: RoutePoint[];
    travelMode: "car";
  }): Promise<OptimizedRoute> {
    const orderedPoints: RoutePoint[] = [params.start];
    const remaining = [...params.waypoints];
    let current = params.start;

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
      orderedPoints.push(next);
      current = next;
    }

    if (params.end) {
      orderedPoints.push(params.end);
    }

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
