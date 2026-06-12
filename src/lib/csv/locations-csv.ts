import { mockGeocode, normalizeAddress } from "@/lib/geo";
import { locationStatusOptions } from "@/lib/status";
import type { Location, LocationStatus } from "@/types/domain";

export function escapeCsvCell(value: unknown) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function locationsToCsv(locations: Location[]) {
  const headers = [
    "customerName",
    "address",
    "lat",
    "lng",
    "status",
    "assignedUserId",
    "constructionDate",
    "nextInspectionDate",
    "memo",
    "tags",
  ];
  const rows = locations.map((location) =>
    [
      location.customerName ?? "",
      location.address,
      location.lat,
      location.lng,
      location.status,
      location.assignedUserId ?? "",
      location.constructionDate ?? "",
      location.nextInspectionDate ?? "",
      location.memo ?? "",
      location.tags?.join("|") ?? "",
    ].map(escapeCsvCell),
  );

  return [headers, ...rows].map((row) => row.join(",")).join("\n");
}

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

export function csvToLocations(
  text: string,
  actorUserId: string,
  now = new Date().toISOString(),
  createId = () => `loc-${crypto.randomUUID()}`,
) {
  const [headers, ...rows] = parseCsv(text);
  if (!headers) return [];
  const headerIndex = new Map(headers.map((header, index) => [header.trim(), index]));

  return rows
    .map<Location | null>((row) => {
      const value = (key: string) => row[headerIndex.get(key) ?? -1]?.trim() ?? "";
      const address = value("address");
      if (!address) return null;
      const geocoded = mockGeocode(address);
      const lat = Number(value("lat") || geocoded.lat);
      const lng = Number(value("lng") || geocoded.lng);
      const statusValue = value("status") as LocationStatus;
      const status = locationStatusOptions.some((option) => option.value === statusValue)
        ? statusValue
        : "unvisited";

      return {
        locationId: createId(),
        customerName: value("customerName") || undefined,
        address,
        normalizedAddress: normalizeAddress(address),
        lat,
        lng,
        status,
        assignedUserId: value("assignedUserId") || undefined,
        constructionDate: value("constructionDate") || undefined,
        nextInspectionDate: value("nextInspectionDate") || undefined,
        memo: value("memo") || undefined,
        tags: value("tags")
          .split(/[|;]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        createdBy: actorUserId,
        updatedBy: actorUserId,
        createdAt: now,
        updatedAt: now,
      } satisfies Location;
    })
    .filter((location): location is Location => Boolean(location));
}
