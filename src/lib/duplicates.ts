import { distanceMeters, normalizeAddress } from "@/lib/geo";
import type { DuplicateCandidate, Location, RoutePoint } from "@/types/domain";

function normalizeName(name?: string) {
  return (name ?? "").replace(/\s+/g, "").trim().toLowerCase();
}

function isSimilarName(a?: string, b?: string) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (left.length < 2 || right.length < 2) return false;
  return left.includes(right) || right.includes(left);
}

function locationToPoint(location: Location): RoutePoint {
  return {
    id: location.locationId,
    lat: location.lat,
    lng: location.lng,
    label: location.customerName || location.address,
  };
}

export function findDuplicateCandidates(
  input: {
    locationId?: string;
    customerName?: string;
    address?: string;
    lat?: number;
    lng?: number;
  },
  existingLocations: Location[],
): DuplicateCandidate[] {
  const normalizedInputAddress = input.address
    ? normalizeAddress(input.address)
    : undefined;
  const inputHasPoint =
    typeof input.lat === "number" &&
    Number.isFinite(input.lat) &&
    typeof input.lng === "number" &&
    Number.isFinite(input.lng);
  const candidates = new Map<string, DuplicateCandidate>();

  function upsert(candidate: DuplicateCandidate) {
    const current = candidates.get(`${candidate.locationId}-${candidate.reason}`);
    if (!current || current.score < candidate.score) {
      candidates.set(`${candidate.locationId}-${candidate.reason}`, candidate);
    }
  }

  existingLocations
    .filter((location) => location.locationId !== input.locationId)
    .forEach((location) => {
      const label = location.customerName || location.address;
      let matchedDuplicate = false;
      if (
        normalizedInputAddress &&
        normalizeAddress(location.normalizedAddress ?? location.address) ===
          normalizedInputAddress
      ) {
        matchedDuplicate = true;
        upsert({
          locationId: location.locationId,
          reason: "same_address",
          score: 100,
          message: `${label} と住所が一致しています。`,
        });
      }

      if (inputHasPoint) {
        const distance = distanceMeters(
          {
            id: "input",
            lat: input.lat as number,
            lng: input.lng as number,
            label: "入力地点",
          },
          locationToPoint(location),
        );
        if (distance <= 20) {
          matchedDuplicate = true;
          upsert({
            locationId: location.locationId,
            reason: "nearby",
            score: 80,
            message: `${label} が半径20m以内にあります。`,
          });
        }
      }

      if (isSimilarName(input.customerName, location.customerName)) {
        matchedDuplicate = true;
        upsert({
          locationId: location.locationId,
          reason: "similar_name",
          score: 50,
          message: `${label} と顧客名が似ています。`,
        });
      }

      if (matchedDuplicate && location.status === "constructed") {
        upsert({
          locationId: location.locationId,
          reason: "constructed",
          score: 70,
          message: `${label} は施工済みです。重複訪問に注意してください。`,
        });
      }

      if (matchedDuplicate && location.status === "inspection_due") {
        upsert({
          locationId: location.locationId,
          reason: "inspection_scheduled",
          score: 60,
          message: `${label} は点検予定があります。担当者と日程を確認してください。`,
        });
      }

      if (matchedDuplicate && location.status === "do_not_visit") {
        upsert({
          locationId: location.locationId,
          reason: "do_not_visit",
          score: 100,
          message: `${label} は訪問NGです。訪問予定に入れないでください。`,
        });
      }
    });

  return [...candidates.values()].sort((a, b) => b.score - a.score);
}

export function findVisitWarningsForLocations(
  locationIds: string[],
  existingLocations: Location[],
) {
  const uniqueIds = [...new Set(locationIds)];
  const warnings: DuplicateCandidate[] = [];
  uniqueIds.forEach((locationId) => {
    const location = existingLocations.find((item) => item.locationId === locationId);
    if (!location) return;
    warnings.push(
      ...findDuplicateCandidates(
        {
          locationId: location.locationId,
          customerName: location.customerName,
          address: location.address,
          lat: location.lat,
          lng: location.lng,
        },
        existingLocations,
      ),
    );

    const label = location.customerName || location.address;
    if (location.status === "constructed") {
      warnings.push({
        locationId,
        reason: "constructed",
        score: 70,
        message: `${label} は施工済みです。訪問目的を確認してください。`,
      });
    }
    if (location.status === "inspection_due") {
      warnings.push({
        locationId,
        reason: "inspection_scheduled",
        score: 60,
        message: `${label} は点検予定です。重複予定になっていないか確認してください。`,
      });
    }
    if (location.status === "do_not_visit") {
      warnings.push({
        locationId,
        reason: "do_not_visit",
        score: 100,
        message: `${label} は訪問NGです。予定追加前に管理者確認が必要です。`,
      });
    }
  });

  return warnings
    .filter(
      (warning, index, all) =>
        all.findIndex(
          (item) =>
            item.locationId === warning.locationId &&
            item.reason === warning.reason &&
            item.message === warning.message,
        ) === index,
    )
    .sort((a, b) => b.score - a.score);
}
