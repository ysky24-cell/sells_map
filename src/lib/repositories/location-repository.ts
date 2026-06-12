import { promises as fs } from "fs";
import { randomUUID } from "crypto";
import path from "path";
import type {
  Location,
  LocationInput,
  LocationRepository,
} from "@/types/domain";

const DATA_PATH = path.join(process.cwd(), "data", "locations.json");

function normalizeAddress(address: string) {
  return address.replace(/\s+/g, "").trim();
}

async function readAllLocations(): Promise<Location[]> {
  const raw = await fs.readFile(DATA_PATH, "utf8");
  return JSON.parse(raw) as Location[];
}

async function writeAllLocations(locations: Location[]) {
  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, `${JSON.stringify(locations, null, 2)}\n`, "utf8");
}

export class JsonLocationRepository implements LocationRepository {
  async list() {
    const locations = await readAllLocations();
    return locations
      .filter((location) => !location.deletedAt)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(locationId: string) {
    const locations = await readAllLocations();
    return (
      locations.find(
        (location) => location.locationId === locationId && !location.deletedAt,
      ) ?? null
    );
  }

  async create(input: LocationInput, actorUserId: string) {
    const locations = await readAllLocations();
    const now = new Date().toISOString();
    const location: Location = {
      ...input,
      locationId: `loc-${randomUUID()}`,
      normalizedAddress: normalizeAddress(input.address),
      tags: input.tags ?? [],
      createdBy: actorUserId,
      updatedBy: actorUserId,
      createdAt: now,
      updatedAt: now,
    };

    locations.push(location);
    await writeAllLocations(locations);
    return location;
  }

  async update(locationId: string, input: LocationInput, actorUserId: string) {
    const locations = await readAllLocations();
    const index = locations.findIndex(
      (location) => location.locationId === locationId && !location.deletedAt,
    );

    if (index === -1) {
      throw new Error("Location not found");
    }

    const next: Location = {
      ...locations[index],
      ...input,
      normalizedAddress: normalizeAddress(input.address),
      tags: input.tags ?? [],
      updatedBy: actorUserId,
      updatedAt: new Date().toISOString(),
    };

    locations[index] = next;
    await writeAllLocations(locations);
    return next;
  }

  async softDelete(locationId: string, actorUserId: string) {
    const locations = await readAllLocations();
    const index = locations.findIndex(
      (location) => location.locationId === locationId && !location.deletedAt,
    );

    if (index === -1) {
      throw new Error("Location not found");
    }

    const next: Location = {
      ...locations[index],
      updatedBy: actorUserId,
      updatedAt: new Date().toISOString(),
      deletedAt: new Date().toISOString(),
    };

    locations[index] = next;
    await writeAllLocations(locations);
    return next;
  }
}

export const locationRepository = new JsonLocationRepository();
