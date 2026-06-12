"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Brush,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Download,
  Eraser,
  Filter,
  LogOut,
  MapPin,
  Pencil,
  Plus,
  Route,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
  UserRound,
  UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  ChangeEvent,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getStatusMeta, locationStatusOptions } from "@/lib/status";
import { mockUsers, findUser } from "@/lib/users";
import seedLocations from "../../data/locations.json";
import seedNotes from "../../data/notes.json";
import seedVisitPlanItems from "../../data/visit-plan-items.json";
import seedVisitPlans from "../../data/visit-plans.json";
import type {
  DuplicateCandidate,
  HandwrittenNote,
  Location,
  LocationInput,
  LocationStatus,
  OptimizedRoute,
  RoutePoint,
  User,
  VisitPlan,
  VisitPlanItem,
  VisitPlanWithItems,
} from "@/types/domain";

type LocationFormState = {
  locationId?: string;
  customerName: string;
  address: string;
  lat: string;
  lng: string;
  status: LocationStatus;
  assignedUserId: string;
  constructionDate: string;
  lastVisitDate: string;
  nextInspectionDate: string;
  memo: string;
  tags: string;
};

const emptyForm: LocationFormState = {
  customerName: "",
  address: "",
  lat: "",
  lng: "",
  status: "unvisited",
  assignedUserId: "sales-001",
  constructionDate: "",
  lastVisitDate: "",
  nextInspectionDate: "",
  memo: "",
  tags: "",
};

const storageKeys = {
  locations: "sales-map.locations",
  notes: "sales-map.notes",
  visitPlans: "sales-map.visitPlans",
  visitPlanItems: "sales-map.visitPlanItems",
};

function readLocalRecords<T>(key: string, seed: T[]): T[] {
  if (typeof window === "undefined") return seed;
  const stored = window.localStorage.getItem(key);
  if (!stored) {
    window.localStorage.setItem(key, JSON.stringify(seed));
    return seed;
  }

  try {
    return JSON.parse(stored) as T[];
  } catch {
    window.localStorage.setItem(key, JSON.stringify(seed));
    return seed;
  }
}

function writeLocalRecords<T>(key: string, records: T[]) {
  window.localStorage.setItem(key, JSON.stringify(records));
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeAddress(address: string) {
  return address.replace(/\s+/g, "").trim();
}

function normalizeName(name?: string) {
  return (name ?? "").replace(/\s+/g, "").trim().toLowerCase();
}

function isSimilarName(a?: string, b?: string) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (left.length < 2 || right.length < 2) return false;
  return left.includes(right) || right.includes(left);
}

function mockGeocode(address: string) {
  const seed = Array.from(address).reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0,
  );

  return {
    lat: 35.62 + (seed % 900) / 10000,
    lng: 139.54 + (seed % 1200) / 10000,
    normalizedAddress: normalizeAddress(address),
  };
}

function listStoredLocations() {
  return readLocalRecords<Location>(
    storageKeys.locations,
    seedLocations as Location[],
  )
    .filter((location) => !location.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function listStoredNotes(locationId: string) {
  return readLocalRecords<HandwrittenNote>(
    storageKeys.notes,
    seedNotes as HandwrittenNote[],
  )
    .filter((note) => note.locationId === locationId && !note.deletedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function withVisitPlanItems(
  plan: VisitPlan,
  items: VisitPlanItem[],
): VisitPlanWithItems {
  return {
    ...plan,
    items: items
      .filter((item) => item.planId === plan.planId)
      .sort((a, b) => a.order - b.order),
  };
}

function listStoredVisitPlans(params: {
  userId?: string;
  date?: string;
}): VisitPlanWithItems[] {
  const plans = readLocalRecords<VisitPlan>(
    storageKeys.visitPlans,
    seedVisitPlans as VisitPlan[],
  );
  const items = readLocalRecords<VisitPlanItem>(
    storageKeys.visitPlanItems,
    seedVisitPlanItems as VisitPlanItem[],
  );

  return plans
    .filter((plan) => !params.userId || plan.userId === params.userId)
    .filter((plan) => !params.date || plan.date === params.date)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((plan) => withVisitPlanItems(plan, items));
}

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

function locationToPoint(location: Location): RoutePoint {
  return {
    id: location.locationId,
    lat: location.lat,
    lng: location.lng,
    label: location.customerName || location.address,
  };
}

function findDuplicateCandidates(
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

function findVisitWarningsForLocations(
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

function optimizeRoutePoints(points: RoutePoint[]): OptimizedRoute {
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

function escapeCsvCell(value: unknown) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function locationsToCsv(locations: Location[]) {
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

function parseCsv(text: string) {
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

function csvToLocations(text: string, actorUserId: string) {
  const [headers, ...rows] = parseCsv(text);
  if (!headers) return [];
  const headerIndex = new Map(headers.map((header, index) => [header.trim(), index]));
  const now = nowIso();

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
        locationId: `loc-${crypto.randomUUID()}`,
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

function toDateString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function toFormState(location: Location): LocationFormState {
  return {
    locationId: location.locationId,
    customerName: location.customerName ?? "",
    address: location.address,
    lat: String(location.lat),
    lng: String(location.lng),
    status: location.status,
    assignedUserId: location.assignedUserId ?? "sales-001",
    constructionDate: location.constructionDate ?? "",
    lastVisitDate: location.lastVisitDate ?? "",
    nextInspectionDate: location.nextInspectionDate ?? "",
    memo: location.memo ?? "",
    tags: location.tags?.join(", ") ?? "",
  };
}

function toLocationInput(form: LocationFormState): LocationInput {
  return {
    customerName: form.customerName.trim() || undefined,
    address: form.address.trim(),
    lat: Number(form.lat || Number.NaN),
    lng: Number(form.lng || Number.NaN),
    status: form.status,
    assignedUserId: form.assignedUserId || undefined,
    constructionDate: form.constructionDate || undefined,
    lastVisitDate: form.lastVisitDate || undefined,
    nextInspectionDate: form.nextInspectionDate || undefined,
    memo: form.memo.trim() || undefined,
    tags: form.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
}

export default function Home() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | LocationStatus>("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [form, setForm] = useState<LocationFormState>(emptyForm);
  const [notes, setNotes] = useState<HandwrittenNote[]>([]);
  const [visitPlan, setVisitPlan] = useState<VisitPlanWithItems | null>(null);
  const [visitPlanDate, setVisitPlanDate] = useState(toDateString());
  const [visitPlanUserId, setVisitPlanUserId] = useState("sales-001");
  const [mapPlanSelectionMode, setMapPlanSelectionMode] = useState(false);
  const [mapSelectedLocationIds, setMapSelectedLocationIds] = useState<string[]>([]);
  const [optimizedRoute, setOptimizedRoute] = useState<OptimizedRoute | null>(null);
  const [notesLoading, setNotesLoading] = useState(false);
  const [visitPlanMessage, setVisitPlanMessage] = useState("");
  const [adminMessage, setAdminMessage] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function loadLocations(showLoading = true) {
    if (showLoading) {
      setIsLoading(true);
    }
    setLocations(listStoredLocations());
    if (showLoading) {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(listStoredLocations()).then((storedLocations) => {
      if (!cancelled) {
        setLocations(storedLocations);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function loadNotes(locationId: string) {
    setNotesLoading(true);
    setNotes(listStoredNotes(locationId));
    setNotesLoading(false);
  }

  const effectiveVisitPlanUserId =
    currentUser?.role === "admin"
      ? visitPlanUserId
      : currentUser?.userId ?? visitPlanUserId;

  async function ensureVisitPlan() {
    const plans = readLocalRecords<VisitPlan>(
      storageKeys.visitPlans,
      seedVisitPlans as VisitPlan[],
    );
    const items = readLocalRecords<VisitPlanItem>(
      storageKeys.visitPlanItems,
      seedVisitPlanItems as VisitPlanItem[],
    );
    const existing = plans.find(
      (plan) =>
        plan.userId === effectiveVisitPlanUserId && plan.date === visitPlanDate,
    );

    if (existing) {
      const plan = withVisitPlanItems(existing, items);
      setVisitPlan(plan);
      return plan;
    }

    const now = nowIso();
    const plan: VisitPlan = {
      planId: `plan-${crypto.randomUUID()}`,
      userId: effectiveVisitPlanUserId,
      date: visitPlanDate,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    };
    const nextPlans = [...plans, plan];
    writeLocalRecords(storageKeys.visitPlans, nextPlans);
    const data = { plan: withVisitPlanItems(plan, items) };
    setVisitPlan(data.plan);
    setOptimizedRoute(null);
    return data.plan;
  }

  async function addLocationToVisitPlan(location: Location) {
    const plan = visitPlan ?? (await ensureVisitPlan());
    if (!plan) return;

    const items = readLocalRecords<VisitPlanItem>(
      storageKeys.visitPlanItems,
      seedVisitPlanItems as VisitPlanItem[],
    );
    const exists = items.some(
      (item) =>
        item.planId === plan.planId && item.locationId === location.locationId,
    );
    if (!exists) {
      const now = nowIso();
      const nextOrder =
        Math.max(
          0,
          ...items
            .filter((item) => item.planId === plan.planId)
            .map((item) => item.order),
        ) + 1;
      items.push({
        planItemId: `plan-item-${crypto.randomUUID()}`,
        planId: plan.planId,
        locationId: location.locationId,
        order: nextOrder,
        priority: "medium",
        createdAt: now,
        updatedAt: now,
      });
      writeLocalRecords(storageKeys.visitPlanItems, items);
    }

    const data = { plan: withVisitPlanItems(plan, items) };
    setVisitPlan(data.plan);
    setOptimizedRoute(null);
    setVisitPlanMessage("訪問先を追加しました。");
  }

  async function addLocationsToVisitPlan(locationIds: string[]) {
    const uniqueLocationIds = [...new Set(locationIds)];
    if (uniqueLocationIds.length === 0) {
      setVisitPlanMessage("地図上で訪問先を選択してください。");
      return;
    }

    let plan = visitPlan ?? (await ensureVisitPlan());
    if (!plan) return;

    const existingLocationIds = new Set(
      plan.items.map((item) => item.locationId),
    );
    const targetLocationIds = uniqueLocationIds.filter(
      (locationId) => !existingLocationIds.has(locationId),
    );

    if (targetLocationIds.length === 0) {
      setVisitPlanMessage("選択した地点はすでに訪問予定に入っています。");
      return;
    }

    const items = readLocalRecords<VisitPlanItem>(
      storageKeys.visitPlanItems,
      seedVisitPlanItems as VisitPlanItem[],
    );
    const now = nowIso();
    let nextOrder =
      Math.max(
        0,
        ...items
          .filter((item) => item.planId === plan.planId)
          .map((item) => item.order),
      ) + 1;
    targetLocationIds.forEach((locationId) => {
      items.push({
        planItemId: `plan-item-${crypto.randomUUID()}`,
        planId: plan.planId,
        locationId,
        order: nextOrder,
        priority: "medium",
        createdAt: now,
        updatedAt: now,
      });
      nextOrder += 1;
    });
    writeLocalRecords(storageKeys.visitPlanItems, items);
    plan = withVisitPlanItems(plan, items);

    setVisitPlan(plan);
    setOptimizedRoute(null);
    setMapSelectedLocationIds([]);
    setVisitPlanMessage(`${targetLocationIds.length}件を訪問予定に追加しました。`);
  }

  function toggleMapPlanSelection(locationId: string) {
    setMapSelectedLocationIds((current) =>
      current.includes(locationId)
        ? current.filter((id) => id !== locationId)
        : [...current, locationId],
    );
  }

  function clearMapPlanSelection() {
    setMapSelectedLocationIds([]);
  }

  async function saveHandwrittenNote(params: {
    locationId: string;
    userId: string;
    title: string;
    dataUrl: string;
  }) {
    const storedNotes = readLocalRecords<HandwrittenNote>(
      storageKeys.notes,
      seedNotes as HandwrittenNote[],
    );
    const now = nowIso();
    const note: HandwrittenNote = {
      noteId: `note-${crypto.randomUUID()}`,
      locationId: params.locationId,
      userId: params.userId,
      s3Key: params.dataUrl,
      mimeType: "image/png",
      title: params.title.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };

    writeLocalRecords(storageKeys.notes, [...storedNotes, note]);
    setNotes(listStoredNotes(params.locationId));
  }

  async function deleteHandwrittenNote(note: HandwrittenNote, actorUserId: string) {
    void actorUserId;
    const storedNotes = readLocalRecords<HandwrittenNote>(
      storageKeys.notes,
      seedNotes as HandwrittenNote[],
    );
    const nextNotes = storedNotes.map((item) =>
      item.noteId === note.noteId
        ? { ...item, updatedAt: nowIso(), deletedAt: nowIso() }
        : item,
    );

    writeLocalRecords(storageKeys.notes, nextNotes);
    setNotes(listStoredNotes(note.locationId));
  }

  async function removeVisitPlanItem(planItemId: string) {
    if (!visitPlan) return;
    const allItems = readLocalRecords<VisitPlanItem>(
      storageKeys.visitPlanItems,
      seedVisitPlanItems as VisitPlanItem[],
    );
    const remaining = allItems
      .filter(
        (item) =>
          !(item.planId === visitPlan.planId && item.planItemId === planItemId),
      )
      .map((item) => ({ ...item }));
    const planItems = remaining
      .filter((item) => item.planId === visitPlan.planId)
      .sort((a, b) => a.order - b.order);
    planItems.forEach((item, index) => {
      item.order = index + 1;
      item.updatedAt = nowIso();
    });
    writeLocalRecords(storageKeys.visitPlanItems, remaining);
    setVisitPlan(withVisitPlanItems(visitPlan, remaining));
    setOptimizedRoute(null);
    setVisitPlanMessage("訪問予定から外しました。");
  }

  async function moveVisitPlanItem(planItemId: string, direction: "up" | "down") {
    if (!visitPlan) return;
    const items = [...visitPlan.items].sort((a, b) => a.order - b.order);
    const index = items.findIndex((item) => item.planItemId === planItemId);
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return;

    const moved = [...items];
    [moved[index], moved[nextIndex]] = [moved[nextIndex], moved[index]];
    const orderMap = new Map(
      moved.map((item, itemIndex) => [item.planItemId, itemIndex + 1]),
    );
    const allItems = readLocalRecords<VisitPlanItem>(
      storageKeys.visitPlanItems,
      seedVisitPlanItems as VisitPlanItem[],
    ).map((item) =>
      item.planId === visitPlan.planId && orderMap.has(item.planItemId)
        ? {
            ...item,
            order: orderMap.get(item.planItemId) ?? item.order,
            updatedAt: nowIso(),
          }
        : item,
    );
    writeLocalRecords(storageKeys.visitPlanItems, allItems);
    setVisitPlan(withVisitPlanItems(visitPlan, allItems));
    setOptimizedRoute(null);
    setVisitPlanMessage("訪問順を変更しました。");
  }

  async function optimizeVisitPlanRoute() {
    if (!visitPlan) {
      setVisitPlanMessage("先に訪問予定を作成してください。");
      return;
    }

    if (visitPlan.items.length < 2) {
      setVisitPlanMessage("ルート最適化には2件以上の訪問先が必要です。");
      return;
    }

    const locationMap = new Map(locations.map((location) => [location.locationId, location]));
    const routePoints = [...visitPlan.items]
      .sort((a, b) => a.order - b.order)
      .map((item) => locationMap.get(item.locationId))
      .filter((location): location is Location => Boolean(location))
      .map((location) => ({
        id: location.locationId,
        lat: location.lat,
        lng: location.lng,
        label: location.customerName || location.address,
      }));
    const route = optimizeRoutePoints(routePoints);
    const orderMap = new Map(
      route.orderedPointIds.map((locationId, index) => [locationId, index + 1]),
    );
    const allItems = readLocalRecords<VisitPlanItem>(
      storageKeys.visitPlanItems,
      seedVisitPlanItems as VisitPlanItem[],
    ).map((item) =>
      item.planId === visitPlan.planId && orderMap.has(item.locationId)
        ? {
            ...item,
            order: orderMap.get(item.locationId) ?? item.order,
            updatedAt: nowIso(),
          }
        : item,
    );
    const allPlans = readLocalRecords<VisitPlan>(
      storageKeys.visitPlans,
      seedVisitPlans as VisitPlan[],
    ).map((plan) =>
      plan.planId === visitPlan.planId
        ? { ...plan, status: "optimized" as const, updatedAt: nowIso() }
        : plan,
    );
    writeLocalRecords(storageKeys.visitPlanItems, allItems);
    writeLocalRecords(storageKeys.visitPlans, allPlans);
    const nextPlan = allPlans.find((plan) => plan.planId === visitPlan.planId);
    if (nextPlan) {
      setVisitPlan(withVisitPlanItems(nextPlan, allItems));
    }
    setOptimizedRoute(route);
    setVisitPlanMessage("ルートを最適化しました。");
  }

  const visibleByRole = useMemo(() => {
    if (!currentUser || currentUser.role === "admin") return locations;
    return locations.filter(
      (location) =>
        location.assignedUserId === currentUser.userId ||
        (location.areaId && currentUser.assignedAreaIds.includes(location.areaId)),
    );
  }, [currentUser, locations]);

  const filteredLocations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return visibleByRole.filter((location) => {
      const matchesQuery =
        !normalizedQuery ||
        [
          location.customerName,
          location.address,
          location.memo,
          location.tags?.join(" "),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      const matchesStatus =
        statusFilter === "all" || location.status === statusFilter;
      const matchesAssignee =
        assigneeFilter === "all" || location.assignedUserId === assigneeFilter;

      return matchesQuery && matchesStatus && matchesAssignee;
    });
  }, [assigneeFilter, query, statusFilter, visibleByRole]);

  const selectedLocation =
    filteredLocations.find((location) => location.locationId === selectedId) ??
    filteredLocations[0] ??
    null;
  const selectedLocationId = selectedLocation?.locationId;
  const formDuplicateCandidates = useMemo(() => {
    if (!form.address.trim() && !form.customerName.trim()) return [];
    const geocoded =
      form.lat && form.lng
        ? { lat: Number(form.lat), lng: Number(form.lng) }
        : form.address.trim()
          ? mockGeocode(form.address)
          : { lat: Number.NaN, lng: Number.NaN };

    return findDuplicateCandidates(
      {
        locationId: form.locationId,
        customerName: form.customerName,
        address: form.address,
        lat: geocoded.lat,
        lng: geocoded.lng,
      },
      locations,
    ).slice(0, 6);
  }, [form, locations]);
  const selectedVisitWarnings = useMemo(
    () =>
      selectedLocation
        ? findVisitWarningsForLocations([selectedLocation.locationId], locations).slice(
            0,
            5,
          )
        : [],
    [locations, selectedLocation],
  );
  const mapSelectionVisitWarnings = useMemo(
    () =>
      findVisitWarningsForLocations(mapSelectedLocationIds, locations).slice(0, 8),
    [locations, mapSelectedLocationIds],
  );

  useEffect(() => {
    let cancelled = false;
    if (!selectedLocationId) {
      Promise.resolve().then(() => {
        if (!cancelled) {
          setNotes([]);
        }
      });

      return () => {
        cancelled = true;
      };
    }

    Promise.resolve(listStoredNotes(selectedLocationId))
      .then((storedNotes) => {
        if (!cancelled) {
          setNotes(storedNotes);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedLocationId]);

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    Promise.resolve(
      listStoredVisitPlans({
        userId: effectiveVisitPlanUserId,
        date: visitPlanDate,
      }),
    )
      .then((plans) => {
        if (!cancelled) {
          setVisitPlan(plans[0] ?? null);
          setOptimizedRoute(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentUser, effectiveVisitPlanUserId, visitPlanDate]);

  const dashboard = useMemo(() => {
    const today = toDateString();
    const ownLocations = currentUser?.role === "sales" ? visibleByRole : locations;

    return {
      todayPlans: ownLocations.filter(
        (location) =>
          location.nextInspectionDate === today ||
          location.status === "inspection_due" ||
          location.status === "absent",
      ).length,
      unvisited: ownLocations.filter((location) => location.status === "unvisited")
        .length,
      revisit: ownLocations.filter((location) => location.status === "absent").length,
      inspections: ownLocations.filter(
        (location) => location.status === "inspection_due",
      ).length,
      constructed: ownLocations.filter((location) => location.status === "constructed")
        .length,
      doNotVisit: ownLocations.filter((location) => location.status === "do_not_visit")
        .length,
    };
  }, [currentUser, locations, visibleByRole]);

  function resetForm() {
    setForm({
      ...emptyForm,
      assignedUserId:
        currentUser?.role === "sales" ? currentUser.userId : emptyForm.assignedUserId,
    });
    setIsEditing(false);
  }

  function startEdit(location: Location) {
    setForm(toFormState(location));
    setIsEditing(true);
    setMessage("");
  }

  async function geocodeAddress(address: string) {
    const trimmedAddress = address.trim();
    if (!trimmedAddress) {
      setMessage("先に住所を入力してください。");
      return null;
    }

    const result = mockGeocode(trimmedAddress);

    setForm((current) => ({
      ...current,
      address: result.normalizedAddress ?? trimmedAddress,
      lat: result.lat.toFixed(6),
      lng: result.lng.toFixed(6),
    }));
    setMessage("住所から位置を計算しました。");
    return result;
  }

  function setFormLocationFromMap(point: { lat: number; lng: number }) {
    setForm((current) => ({
      ...current,
      lat: point.lat.toFixed(6),
      lng: point.lng.toFixed(6),
      address:
        current.address ||
        `地図タップ地点 ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`,
    }));
    setMessage("地図タップで位置を指定しました。住所は必要に応じて入力してください。");
  }

  async function submitLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentUser) return;

    if (!form.address.trim()) {
      setMessage("住所を入力するか、地図をタップして地点を指定してください。");
      return;
    }

    let nextForm = form;
    let input = toLocationInput(nextForm);
    if (Number.isNaN(input.lat) || Number.isNaN(input.lng)) {
      const geocoded = await geocodeAddress(form.address);
      if (!geocoded) return;
      nextForm = {
        ...form,
        address: geocoded.normalizedAddress ?? form.address.trim(),
        lat: geocoded.lat.toFixed(6),
        lng: geocoded.lng.toFixed(6),
      };
      input = toLocationInput(nextForm);
    }

    const storedLocations = readLocalRecords<Location>(
      storageKeys.locations,
      seedLocations as Location[],
    );
    const now = nowIso();
    let savedLocation: Location;
    if (form.locationId) {
      const index = storedLocations.findIndex(
        (location) => location.locationId === form.locationId,
      );
      if (index === -1) {
        setMessage("保存に失敗しました。");
        return;
      }

      savedLocation = {
        ...storedLocations[index],
        ...input,
        normalizedAddress: normalizeAddress(input.address),
        tags: input.tags ?? [],
        updatedBy: currentUser.userId,
        updatedAt: now,
      };
      storedLocations[index] = savedLocation;
    } else {
      savedLocation = {
        ...input,
        locationId: `loc-${crypto.randomUUID()}`,
        normalizedAddress: normalizeAddress(input.address),
        tags: input.tags ?? [],
        createdBy: currentUser.userId,
        updatedBy: currentUser.userId,
        createdAt: now,
        updatedAt: now,
      };
      storedLocations.push(savedLocation);
    }

    writeLocalRecords(storageKeys.locations, storedLocations);
    await loadLocations();
    setSelectedId(savedLocation.locationId);
    resetForm();
    setMessage(form.locationId ? "地点を更新しました。" : "地点を追加しました。");
  }

  async function deleteLocation(location: Location) {
    if (!currentUser) return;
    const ok = window.confirm(`${location.address} を削除しますか？`);
    if (!ok) return;

    const storedLocations = readLocalRecords<Location>(
      storageKeys.locations,
      seedLocations as Location[],
    );
    const index = storedLocations.findIndex(
      (item) => item.locationId === location.locationId,
    );
    if (index === -1) {
      setMessage("削除に失敗しました。");
      return;
    }

    storedLocations[index] = {
      ...storedLocations[index],
      updatedBy: currentUser.userId,
      updatedAt: nowIso(),
      deletedAt: nowIso(),
    };
    writeLocalRecords(storageKeys.locations, storedLocations);
    await loadLocations();
    setSelectedId(null);
    resetForm();
    setMessage("地点を削除しました。");
  }

  function exportLocationsCsv() {
    const csv = locationsToCsv(locations);
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sales-map-locations-${toDateString()}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setAdminMessage(`${locations.length}件をCSVエクスポートしました。`);
  }

  async function importLocationsCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !currentUser) return;

    try {
      const text = await file.text();
      const imported = csvToLocations(text, currentUser.userId);
      if (imported.length === 0) {
        setAdminMessage("取り込める地点がありませんでした。");
        return;
      }

      const storedLocations = readLocalRecords<Location>(
        storageKeys.locations,
        seedLocations as Location[],
      );
      writeLocalRecords(storageKeys.locations, [...storedLocations, ...imported]);
      await loadLocations();
      setAdminMessage(`${imported.length}件をCSVインポートしました。`);
    } catch {
      setAdminMessage("CSVインポートに失敗しました。列名を確認してください。");
    }
  }

  if (!currentUser) {
    return <LoginScreen onLogin={setCurrentUser} />;
  }

  return (
    <main className="min-h-screen bg-[#f7f7f2] text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-md bg-emerald-700 text-white">
                <MapPin size={22} />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-500">
                  シロアリ防除 訪問管理
                </p>
                <h1 className="text-2xl font-semibold tracking-normal">
                  営業用地図アプリ
                </h1>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
              <UserRound size={16} />
              {currentUser.name}
              <span className="rounded bg-zinc-900 px-2 py-0.5 text-xs text-white">
                {currentUser.role === "admin" ? "管理者" : "営業"}
              </span>
            </span>
            <button
              className="inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50"
              type="button"
              onClick={() => {
                setCurrentUser(null);
                resetForm();
              }}
            >
              <LogOut size={16} />
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 xl:grid-cols-[320px_1fr]">
        <aside className="space-y-5">
          <DashboardPanel
            currentUser={currentUser}
            dashboard={dashboard}
            locations={visibleByRole}
          />
          <LocationForm
            currentUser={currentUser}
            form={form}
            isEditing={isEditing}
            message={message}
            duplicateCandidates={formDuplicateCandidates}
            onChange={setForm}
            onCancel={resetForm}
            onGeocodeAddress={() => geocodeAddress(form.address)}
            onSubmit={submitLocation}
          />
          <VisitPlanPanel
            currentUser={currentUser}
            date={visitPlanDate}
            planUserId={effectiveVisitPlanUserId}
            visitPlan={visitPlan}
            locations={locations}
            selectedLocation={selectedLocation}
            mapSelectedLocationIds={mapSelectedLocationIds}
            mapPlanSelectionMode={mapPlanSelectionMode}
            optimizedRoute={optimizedRoute}
            selectedWarnings={selectedVisitWarnings}
            mapSelectionWarnings={mapSelectionVisitWarnings}
            message={visitPlanMessage}
            onDateChange={(date) => {
              setVisitPlanDate(date);
              setVisitPlanMessage("");
            }}
            onPlanUserChange={(userId) => {
              setVisitPlanUserId(userId);
              setVisitPlanMessage("");
            }}
            onCreatePlan={ensureVisitPlan}
            onAddSelected={addLocationToVisitPlan}
            onAddMapSelection={addLocationsToVisitPlan}
            onMoveItem={moveVisitPlanItem}
            onRemoveItem={removeVisitPlanItem}
            onOptimizeRoute={optimizeVisitPlanRoute}
            onToggleMapSelectionMode={() =>
              setMapPlanSelectionMode((current) => !current)
            }
            onClearMapSelection={clearMapPlanSelection}
          />
        </aside>

        <section className="space-y-5">
          <FilterBar
            query={query}
            statusFilter={statusFilter}
            assigneeFilter={assigneeFilter}
            onQueryChange={setQuery}
            onStatusChange={setStatusFilter}
            onAssigneeChange={setAssigneeFilter}
          />

          {currentUser.role === "admin" ? (
            <AdminPanel
              locations={locations}
              duplicateCandidates={locations
                .flatMap((location) =>
                  findDuplicateCandidates(
                    {
                      locationId: location.locationId,
                      customerName: location.customerName,
                      address: location.address,
                      lat: location.lat,
                      lng: location.lng,
                    },
                    locations,
                  ),
                )
                .slice(0, 12)}
              message={adminMessage}
              onExportCsv={exportLocationsCsv}
              onImportCsv={importLocationsCsv}
            />
          ) : null}

          <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
            <MockMap
              locations={filteredLocations}
              selectedId={selectedLocation?.locationId ?? null}
              planSelectionMode={mapPlanSelectionMode}
              planSelectedLocationIds={mapSelectedLocationIds}
              routeLocationIds={optimizedRoute?.orderedPointIds ?? []}
              onSelect={setSelectedId}
              onTogglePlanSelection={toggleMapPlanSelection}
              onMapPick={setFormLocationFromMap}
              isLoading={isLoading}
            />
            <LocationDetail
              location={selectedLocation}
              currentUser={currentUser}
              notes={notes}
              notesLoading={notesLoading}
              onEdit={startEdit}
              onDelete={deleteLocation}
              onNotesChanged={(locationId) => loadNotes(locationId)}
              onSaveNote={saveHandwrittenNote}
              onDeleteNote={deleteHandwrittenNote}
            />
          </div>

          <LocationTable
            locations={filteredLocations}
            selectedId={selectedLocation?.locationId ?? null}
            onSelect={setSelectedId}
          />
        </section>
      </div>
    </main>
  );
}

function LoginScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [selectedUserId, setSelectedUserId] = useState("admin-001");
  const selectedUser = findUser(selectedUserId) ?? mockUsers[0];

  return (
    <main className="min-h-screen bg-[#f7f7f2] text-zinc-950">
      <div className="mx-auto grid min-h-screen max-w-6xl gap-8 px-4 py-8 lg:grid-cols-[1fr_420px] lg:items-center">
        <section className="space-y-8">
          <div className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
            <ShieldCheck size={16} />
            Mock Cognito Mode
          </div>
          <div className="max-w-3xl space-y-5">
            <h1 className="text-4xl font-semibold tracking-normal text-zinc-950 sm:text-5xl">
              紙地図の訪問情報を、共有できる業務データへ。
            </h1>
            <p className="text-lg leading-8 text-zinc-700">
              施工済み、点検予定、訪問済み、訪問NGをタブレットで確認できる
              Step 1〜5 のプロトタイプです。地図APIなしで動くモック地図を使います。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniStat icon={<MapPin size={18} />} label="地点管理" value="CRUD" />
            <MiniStat icon={<UsersRound size={18} />} label="ロール" value="2種類" />
            <MiniStat icon={<Route size={18} />} label="地図" value="Mock" />
          </div>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="mb-5">
            <h2 className="text-xl font-semibold">ログイン</h2>
            <p className="mt-1 text-sm text-zinc-600">
              初回はCognitoの代わりにユーザーを選択します。
            </p>
          </div>
          <div className="space-y-3">
            {mockUsers.map((user) => (
              <button
                key={user.userId}
                type="button"
                onClick={() => setSelectedUserId(user.userId)}
                className={`flex w-full items-center justify-between rounded-md border px-3 py-3 text-left transition ${
                  selectedUserId === user.userId
                    ? "border-emerald-600 bg-emerald-50"
                    : "border-zinc-200 bg-white hover:bg-zinc-50"
                }`}
              >
                <span>
                  <span className="block font-medium">{user.name}</span>
                  <span className="text-sm text-zinc-600">{user.email}</span>
                </span>
                <span className="rounded bg-zinc-900 px-2 py-1 text-xs text-white">
                  {user.role === "admin" ? "管理者" : "営業"}
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onLogin(selectedUser)}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800"
          >
            <CheckCircle2 size={18} />
            ログイン
          </button>
        </section>
      </div>
    </main>
  );
}

function DashboardPanel({
  currentUser,
  dashboard,
  locations,
}: {
  currentUser: User;
  dashboard: {
    todayPlans: number;
    unvisited: number;
    revisit: number;
    inspections: number;
    constructed: number;
    doNotVisit: number;
  };
  locations: Location[];
}) {
  const stats =
    currentUser.role === "admin"
      ? [
          { label: "本日の訪問予定", value: dashboard.todayPlans, icon: CalendarClock },
          { label: "施工済み", value: dashboard.constructed, icon: CheckCircle2 },
          { label: "点検予定", value: dashboard.inspections, icon: ClipboardList },
          { label: "訪問NG", value: dashboard.doNotVisit, icon: AlertTriangle },
        ]
      : [
          { label: "今日の訪問候補", value: dashboard.todayPlans, icon: CalendarClock },
          { label: "未訪問", value: dashboard.unvisited, icon: MapPin },
          { label: "再訪問", value: dashboard.revisit, icon: Route },
          { label: "点検予定", value: dashboard.inspections, icon: ClipboardList },
        ];

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">
          {currentUser.role === "admin" ? "管理者ダッシュボード" : "営業ダッシュボード"}
        </h2>
        <span className="text-sm text-zinc-500">{locations.length}件</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="rounded-md border border-zinc-200 p-3">
              <div className="flex items-center gap-2 text-sm text-zinc-600">
                <Icon size={16} />
                {stat.label}
              </div>
              <p className="mt-2 text-2xl font-semibold">{stat.value}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AdminPanel({
  locations,
  duplicateCandidates,
  message,
  onExportCsv,
  onImportCsv,
}: {
  locations: Location[];
  duplicateCandidates: DuplicateCandidate[];
  message: string;
  onExportCsv: () => void;
  onImportCsv: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const statusCounts = locationStatusOptions
    .map((option) => ({
      ...option,
      count: locations.filter((location) => location.status === option.value).length,
    }))
    .filter((item) => item.count > 0);
  const userCounts = mockUsers
    .filter((user) => user.role === "sales")
    .map((user) => ({
      user,
      count: locations.filter((location) => location.assignedUserId === user.userId)
        .length,
    }));
  const doNotVisitCount = locations.filter(
    (location) => location.status === "do_not_visit",
  ).length;
  const inspectionCount = locations.filter(
    (location) => location.status === "inspection_due",
  ).length;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 size={18} />
            <h2 className="font-semibold">管理者画面</h2>
          </div>
          <p className="mt-1 text-sm text-zinc-600">
            担当者別・ステータス別の状況確認とCSV入出力を行います。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50">
            <Upload size={16} />
            CSVインポート
            <input
              className="hidden"
              type="file"
              accept=".csv,text/csv"
              onChange={onImportCsv}
            />
          </label>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
            onClick={onExportCsv}
          >
            <Download size={16} />
            CSVエクスポート
          </button>
        </div>
      </div>

      {message ? (
        <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
          {message}
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <MiniStat icon={<MapPin size={18} />} label="地点総数" value={`${locations.length}`} />
        <MiniStat icon={<ClipboardList size={18} />} label="点検予定" value={`${inspectionCount}`} />
        <MiniStat icon={<AlertTriangle size={18} />} label="訪問NG" value={`${doNotVisitCount}`} />
        <MiniStat
          icon={<ShieldCheck size={18} />}
          label="重複候補"
          value={`${duplicateCandidates.length}`}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-zinc-200 p-3">
          <h3 className="text-sm font-semibold">ステータス別件数</h3>
          <div className="mt-3 space-y-2">
            {statusCounts.map((item) => (
              <div key={item.value} className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-sm">
                  <span
                    className="size-3 rounded-full"
                    style={{ backgroundColor: item.marker }}
                  />
                  {item.label}
                </span>
                <span className="font-semibold">{item.count}件</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-zinc-200 p-3">
          <h3 className="text-sm font-semibold">担当者別件数</h3>
          <div className="mt-3 space-y-2">
            {userCounts.map(({ user, count }) => (
              <div key={user.userId} className="flex items-center justify-between gap-3">
                <span className="text-sm">{user.name}</span>
                <span className="font-semibold">{count}件</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-zinc-200 p-3">
        <h3 className="text-sm font-semibold">重複候補・注意一覧</h3>
        {duplicateCandidates.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600">現在、重複候補はありません。</p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {duplicateCandidates.map((candidate) => (
              <li
                key={`${candidate.locationId}-${candidate.reason}-${candidate.message}`}
                className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-950"
              >
                {candidate.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function VisitPlanPanel({
  currentUser,
  date,
  planUserId,
  visitPlan,
  locations,
  selectedLocation,
  mapSelectedLocationIds,
  mapPlanSelectionMode,
  optimizedRoute,
  selectedWarnings,
  mapSelectionWarnings,
  message,
  onDateChange,
  onPlanUserChange,
  onCreatePlan,
  onAddSelected,
  onAddMapSelection,
  onMoveItem,
  onRemoveItem,
  onOptimizeRoute,
  onToggleMapSelectionMode,
  onClearMapSelection,
}: {
  currentUser: User;
  date: string;
  planUserId: string;
  visitPlan: VisitPlanWithItems | null;
  locations: Location[];
  selectedLocation: Location | null;
  mapSelectedLocationIds: string[];
  mapPlanSelectionMode: boolean;
  optimizedRoute: OptimizedRoute | null;
  selectedWarnings: DuplicateCandidate[];
  mapSelectionWarnings: DuplicateCandidate[];
  message: string;
  onDateChange: (date: string) => void;
  onPlanUserChange: (userId: string) => void;
  onCreatePlan: () => Promise<VisitPlanWithItems | null>;
  onAddSelected: (location: Location) => void;
  onAddMapSelection: (locationIds: string[]) => void;
  onMoveItem: (planItemId: string, direction: "up" | "down") => void;
  onRemoveItem: (planItemId: string) => void;
  onOptimizeRoute: () => void;
  onToggleMapSelectionMode: () => void;
  onClearMapSelection: () => void;
}) {
  const sortedItems = visitPlan
    ? [...visitPlan.items].sort((a, b) => a.order - b.order)
    : [];
  const selectedAlreadyAdded =
    selectedLocation &&
    sortedItems.some((item) => item.locationId === selectedLocation.locationId);

  function locationForItem(locationId: string) {
    return locations.find((location) => location.locationId === locationId);
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-semibold">訪問予定</h2>
          <p className="mt-1 text-sm text-zinc-600">今日回る候補を順番に並べます。</p>
        </div>
        <Route size={18} className="text-zinc-500" />
      </div>

      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-zinc-700">訪問日</span>
          <input
            className="h-10 w-full rounded-md border border-zinc-300 px-3 outline-none focus:border-emerald-600"
            type="date"
            value={date}
            onChange={(event) => onDateChange(event.target.value)}
          />
        </label>

        {currentUser.role === "admin" ? (
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-zinc-700">担当者</span>
            <select
              className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 outline-none focus:border-emerald-600"
              value={planUserId}
              onChange={(event) => onPlanUserChange(event.target.value)}
            >
              {mockUsers
                .filter((user) => user.role === "sales")
                .map((user) => (
                  <option key={user.userId} value={user.userId}>
                    {user.name}
                  </option>
                ))}
            </select>
          </label>
        ) : null}

        <div className="flex gap-2">
          <button
            type="button"
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50"
            onClick={onCreatePlan}
          >
            <CalendarClock size={16} />
            予定を作成
          </button>
          <button
            type="button"
            disabled={!selectedLocation || Boolean(selectedAlreadyAdded)}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-zinc-300"
            onClick={() => selectedLocation && onAddSelected(selectedLocation)}
          >
            <Plus size={16} />
            選択地点を追加
          </button>
        </div>

        {selectedLocation ? (
          <DuplicateWarningList
            title="選択地点の注意"
            candidates={selectedWarnings}
            compact
          />
        ) : null}

        <div className="rounded-md border border-zinc-200 bg-white p-3">
          <button
            type="button"
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:bg-zinc-300"
            disabled={!visitPlan || sortedItems.length < 2}
            onClick={onOptimizeRoute}
          >
            <Route size={16} />
            ルート最適化
          </button>
          {optimizedRoute ? (
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-md bg-zinc-50 p-2">
                <p className="text-xs text-zinc-500">総距離</p>
                <p className="font-semibold">
                  {((optimizedRoute.totalDistanceMeters ?? 0) / 1000).toFixed(1)} km
                </p>
              </div>
              <div className="rounded-md bg-zinc-50 p-2">
                <p className="text-xs text-zinc-500">推定時間</p>
                <p className="font-semibold">
                  {Math.max(
                    1,
                    Math.round((optimizedRoute.totalDurationSeconds ?? 0) / 60),
                  )}
                  分
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs leading-5 text-zinc-600">
              訪問先を2件以上入れると、現在の先頭を出発地点として近い順に並べ替えます。
            </p>
          )}
        </div>

        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-zinc-800">地図でまとめて選択</p>
              <p className="mt-1 text-xs leading-5 text-zinc-600">
                件数が多い日は、地図上のピンを複数選んで一括追加します。
              </p>
            </div>
            <span className="shrink-0 rounded bg-white px-2 py-1 text-xs font-semibold text-zinc-700">
              {mapSelectedLocationIds.length}件
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              className={`inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${
                mapPlanSelectionMode
                  ? "border-emerald-700 bg-emerald-700 text-white"
                  : "border-zinc-300 bg-white hover:bg-zinc-50"
              }`}
              onClick={onToggleMapSelectionMode}
            >
              <MapPin size={16} />
              {mapPlanSelectionMode ? "選択中" : "地図で選ぶ"}
            </button>
            <button
              type="button"
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
              disabled={mapSelectedLocationIds.length === 0}
              onClick={onClearMapSelection}
            >
              選択解除
            </button>
          </div>
          <button
            type="button"
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-zinc-300"
            disabled={mapSelectedLocationIds.length === 0}
            onClick={() => onAddMapSelection(mapSelectedLocationIds)}
          >
            <Plus size={16} />
            選択した地点をまとめて追加
          </button>
          <DuplicateWarningList
            title="地図選択中の注意"
            candidates={mapSelectionWarnings}
            compact
          />
        </div>

        {message ? (
          <p className="text-sm font-medium text-emerald-800">{message}</p>
        ) : null}

        <div className="space-y-2">
          {sortedItems.length === 0 ? (
            <p className="rounded-md bg-zinc-50 p-3 text-sm text-zinc-600">
              まだ訪問先がありません。地図や一覧で地点を選び、追加してください。
            </p>
          ) : null}

          {sortedItems.map((item, index) => {
            const location = locationForItem(item.locationId);
            return (
              <div
                key={item.planItemId}
                className="rounded-md border border-zinc-200 bg-zinc-50 p-3"
              >
                <div className="flex items-start gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded bg-zinc-900 text-sm font-semibold text-white">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {location?.customerName || "名称未設定"}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-600">
                      {location?.address ?? "地点が見つかりません"}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="grid size-8 place-items-center rounded-md border border-zinc-300 bg-white hover:bg-zinc-50 disabled:opacity-40"
                    disabled={index === 0}
                    onClick={() => onMoveItem(item.planItemId, "up")}
                    aria-label="訪問順を上へ"
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    type="button"
                    className="grid size-8 place-items-center rounded-md border border-zinc-300 bg-white hover:bg-zinc-50 disabled:opacity-40"
                    disabled={index === sortedItems.length - 1}
                    onClick={() => onMoveItem(item.planItemId, "down")}
                    aria-label="訪問順を下へ"
                  >
                    <ArrowDown size={15} />
                  </button>
                  <button
                    type="button"
                    className="ml-auto grid size-8 place-items-center rounded-md border border-rose-200 bg-white text-rose-700 hover:bg-rose-50"
                    onClick={() => onRemoveItem(item.planItemId)}
                    aria-label="訪問予定から外す"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function DuplicateWarningList({
  title,
  candidates,
  compact = false,
}: {
  title: string;
  candidates: DuplicateCandidate[];
  compact?: boolean;
}) {
  if (candidates.length === 0) return null;

  return (
    <div
      className={`rounded-md border border-amber-200 bg-amber-50 ${
        compact ? "p-3" : "p-4"
      }`}
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-950">
        <AlertTriangle size={16} />
        {title}
      </div>
      <ul className="mt-2 space-y-1">
        {candidates.map((candidate) => (
          <li
            key={`${candidate.locationId}-${candidate.reason}-${candidate.message}`}
            className="text-xs leading-5 text-amber-950"
          >
            {candidate.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FilterBar({
  query,
  statusFilter,
  assigneeFilter,
  onQueryChange,
  onStatusChange,
  onAssigneeChange,
}: {
  query: string;
  statusFilter: "all" | LocationStatus;
  assigneeFilter: string;
  onQueryChange: (value: string) => void;
  onStatusChange: (value: "all" | LocationStatus) => void;
  onAssigneeChange: (value: string) => void;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 lg:grid-cols-[1fr_190px_190px]">
        <label className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            size={18}
          />
          <input
            className="h-11 w-full rounded-md border border-zinc-300 bg-white pl-10 pr-3 text-sm outline-none focus:border-emerald-600"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="顧客名・住所・メモ・タグで検索"
          />
        </label>
        <label className="relative">
          <Filter
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            size={18}
          />
          <select
            className="h-11 w-full appearance-none rounded-md border border-zinc-300 bg-white pl-10 pr-3 text-sm outline-none focus:border-emerald-600"
            value={statusFilter}
            onChange={(event) =>
              onStatusChange(event.target.value as "all" | LocationStatus)
            }
          >
            <option value="all">すべてのステータス</option>
            {locationStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="relative">
          <UsersRound
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            size={18}
          />
          <select
            className="h-11 w-full appearance-none rounded-md border border-zinc-300 bg-white pl-10 pr-3 text-sm outline-none focus:border-emerald-600"
            value={assigneeFilter}
            onChange={(event) => onAssigneeChange(event.target.value)}
          >
            <option value="all">すべての担当者</option>
            {mockUsers
              .filter((user) => user.role === "sales")
              .map((user) => (
                <option key={user.userId} value={user.userId}>
                  {user.name}
                </option>
              ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function MockMap({
  locations,
  selectedId,
  planSelectionMode,
  planSelectedLocationIds,
  routeLocationIds,
  onSelect,
  onTogglePlanSelection,
  onMapPick,
  isLoading,
}: {
  locations: Location[];
  selectedId: string | null;
  planSelectionMode: boolean;
  planSelectedLocationIds: string[];
  routeLocationIds: string[];
  onSelect: (locationId: string) => void;
  onTogglePlanSelection: (locationId: string) => void;
  onMapPick: (point: { lat: number; lng: number }) => void;
  isLoading: boolean;
}) {
  const bounds = useMemo(() => {
    const lats = locations.map((location) => location.lat);
    const lngs = locations.map((location) => location.lng);
    return {
      minLat: Math.min(...lats, 35.58),
      maxLat: Math.max(...lats, 35.72),
      minLng: Math.min(...lngs, 139.52),
      maxLng: Math.max(...lngs, 139.68),
    };
  }, [locations]);

  function handleMapClick(event: ReactMouseEvent<HTMLElement>) {
    if (planSelectionMode) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const xPercent = ((event.clientX - rect.left) / rect.width) * 100;
    const yPercent = ((event.clientY - rect.top) / rect.height) * 100;
    const lng =
      bounds.minLng +
      ((xPercent - 8) / 82) * (bounds.maxLng - bounds.minLng || 1);
    const lat =
      bounds.minLat +
      (1 - (yPercent - 14) / 72) * (bounds.maxLat - bounds.minLat || 1);

    onMapPick({
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
    });
  }

  function positionFor(location: Location) {
    const x =
      ((location.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng || 1)) * 82 +
      8;
    const y =
      (1 - (location.lat - bounds.minLat) / (bounds.maxLat - bounds.minLat || 1)) *
        72 +
      14;

    return { x, y };
  }

  const routeLocations = routeLocationIds
    .map((locationId) =>
      locations.find((location) => location.locationId === locationId),
    )
    .filter((location): location is Location => Boolean(location));
  const routePoints = routeLocations
    .map((location) => {
      const position = positionFor(location);
      return `${position.x},${position.y}`;
    })
    .join(" ");

  return (
    <section
      className={`relative min-h-[520px] overflow-hidden rounded-lg border border-zinc-200 bg-[#e9efe7] shadow-sm ${
        planSelectionMode ? "cursor-default" : "cursor-crosshair"
      }`}
      onClick={handleMapClick}
    >
      <div className="absolute inset-0 grid grid-cols-6 grid-rows-6 opacity-50">
        {Array.from({ length: 36 }).map((_, index) => (
          <div key={index} className="border border-white/70" />
        ))}
      </div>
      <div className="absolute left-0 right-0 top-[18%] h-3 rotate-[-7deg] bg-white/80" />
      <div className="absolute left-[-5%] right-[-5%] top-[55%] h-4 rotate-[12deg] bg-white/80" />
      <div className="absolute bottom-0 left-[18%] top-0 w-4 rotate-[6deg] bg-white/80" />
      {routeLocations.length >= 2 ? (
        <svg
          className="pointer-events-none absolute inset-0 size-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline
            points={routePoints}
            fill="none"
            stroke="#111827"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="2 1.4"
          />
          {routeLocations.map((location, index) => {
            const position = positionFor(location);
            return (
              <g key={location.locationId}>
                <circle cx={position.x} cy={position.y} r="2.4" fill="#111827" />
                <text
                  x={position.x}
                  y={position.y + 0.75}
                  textAnchor="middle"
                  className="fill-white text-[3px] font-bold"
                >
                  {index + 1}
                </text>
              </g>
            );
          })}
        </svg>
      ) : null}
      <div
        className="absolute inset-x-4 top-4 flex items-center justify-between rounded-md border border-zinc-200 bg-white/95 px-3 py-2 text-sm shadow-sm"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="font-medium">MockMapProvider</span>
        <span className="text-zinc-500">
          {isLoading
            ? "読み込み中"
            : planSelectionMode
              ? `${locations.length}件表示・ピンを複数選択`
              : `${locations.length}件表示・地図タップで位置指定`}
        </span>
      </div>

      {planSelectionMode ? (
        <div
          className="absolute left-4 top-16 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 shadow-sm"
          onClick={(event) => event.stopPropagation()}
        >
          訪問予定に入れる地点を地図上で選択中: {planSelectedLocationIds.length}件
        </div>
      ) : null}

      {locations.map((location) => {
        const meta = getStatusMeta(location.status);
        const isPlanSelected = planSelectedLocationIds.includes(location.locationId);
        const { x, y } = positionFor(location);

        return (
          <button
            key={location.locationId}
            type="button"
            title={`${location.customerName ?? "名称未設定"} ${location.address}`}
            onClick={(event) => {
              event.stopPropagation();
              if (planSelectionMode) {
                onTogglePlanSelection(location.locationId);
              } else {
                onSelect(location.locationId);
              }
            }}
            className={`absolute grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 text-xs font-bold text-white shadow-lg transition hover:scale-110 ${
              isPlanSelected
                ? "border-emerald-950 ring-4 ring-emerald-200"
                : selectedId === location.locationId
                  ? "border-zinc-950 ring-4 ring-white"
                  : "border-white"
            }`}
            style={{ left: `${x}%`, top: `${y}%`, backgroundColor: meta.marker }}
          >
            {isPlanSelected ? "✓" : meta.shortLabel}
          </button>
        );
      })}

      <div
        className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-2 rounded-md border border-zinc-200 bg-white/95 p-3 shadow-sm"
        onClick={(event) => event.stopPropagation()}
      >
        {locationStatusOptions.slice(0, 8).map((option) => (
          <span key={option.value} className="inline-flex items-center gap-2 text-xs">
            <span
              className="size-3 rounded-full"
              style={{ backgroundColor: option.marker }}
            />
            {option.label}
          </span>
        ))}
      </div>
    </section>
  );
}

function LocationDetail({
  location,
  currentUser,
  notes,
  notesLoading,
  onEdit,
  onDelete,
  onNotesChanged,
  onSaveNote,
  onDeleteNote,
}: {
  location: Location | null;
  currentUser: User;
  notes: HandwrittenNote[];
  notesLoading: boolean;
  onEdit: (location: Location) => void;
  onDelete: (location: Location) => void;
  onNotesChanged: (locationId: string) => void;
  onSaveNote: (params: {
    locationId: string;
    userId: string;
    title: string;
    dataUrl: string;
  }) => Promise<void>;
  onDeleteNote: (note: HandwrittenNote, actorUserId: string) => Promise<void>;
}) {
  if (!location) {
    return (
      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold">地点詳細</h2>
        <p className="mt-3 text-sm text-zinc-600">表示する地点がありません。</p>
      </section>
    );
  }

  const meta = getStatusMeta(location.status);
  const assignee = findUser(location.assignedUserId);

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span
            className={`inline-flex rounded px-2 py-1 text-xs font-semibold text-white ${meta.color}`}
          >
            {meta.label}
          </span>
          <h2 className="mt-3 text-xl font-semibold">
            {location.customerName || "名称未設定"}
          </h2>
          <p className="mt-1 text-sm leading-6 text-zinc-600">{location.address}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="grid size-9 place-items-center rounded-md border border-zinc-300 hover:bg-zinc-50"
            onClick={() => onEdit(location)}
            aria-label="地点を編集"
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            className="grid size-9 place-items-center rounded-md border border-rose-200 text-rose-700 hover:bg-rose-50"
            onClick={() => onDelete(location)}
            aria-label="地点を削除"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <dl className="mt-5 grid gap-3 text-sm">
        <DetailRow label="担当者" value={assignee?.name ?? "未割当"} />
        <DetailRow label="緯度経度" value={`${location.lat}, ${location.lng}`} />
        <DetailRow label="施工日" value={location.constructionDate ?? "-"} />
        <DetailRow label="最終訪問日" value={location.lastVisitDate ?? "-"} />
        <DetailRow label="次回点検" value={location.nextInspectionDate ?? "-"} />
      </dl>

      <div className="mt-5 rounded-md bg-zinc-50 p-3">
        <p className="text-xs font-semibold text-zinc-500">メモ</p>
        <p className="mt-2 text-sm leading-6 text-zinc-700">
          {location.memo || "メモはありません。"}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(location.tags ?? []).map((tag) => (
          <span key={tag} className="rounded bg-zinc-100 px-2 py-1 text-xs">
            {tag}
          </span>
        ))}
      </div>

      <HandwrittenNotesSection
        currentUser={currentUser}
        location={location}
        notes={notes}
        notesLoading={notesLoading}
        onNotesChanged={onNotesChanged}
        onSaveNote={onSaveNote}
        onDeleteNote={onDeleteNote}
      />
    </section>
  );
}

function HandwrittenNotesSection({
  currentUser,
  location,
  notes,
  notesLoading,
  onNotesChanged,
  onSaveNote,
  onDeleteNote,
}: {
  currentUser: User;
  location: Location;
  notes: HandwrittenNote[];
  notesLoading: boolean;
  onNotesChanged: (locationId: string) => void;
  onSaveNote: (params: {
    locationId: string;
    userId: string;
    title: string;
    dataUrl: string;
  }) => Promise<void>;
  onDeleteNote: (note: HandwrittenNote, actorUserId: string) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [saving, setSaving] = useState(false);
  const [noteMessage, setNoteMessage] = useState("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.lineCap = "round";
    context.lineJoin = "round";
  }, [isOpen, location.locationId]);

  function getPoint(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function startDrawing(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    drawingRef.current = true;
    canvas.setPointerCapture(event.pointerId);
    const point = getPoint(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
  }

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;

    const point = getPoint(event);
    context.globalCompositeOperation =
      tool === "eraser" ? "destination-out" : "source-over";
    context.strokeStyle = tool === "eraser" ? "rgba(0,0,0,1)" : "#18181b";
    context.lineWidth = tool === "eraser" ? 22 : 4;
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function stopDrawing(event: PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false;
    canvasRef.current?.releasePointerCapture(event.pointerId);
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.globalCompositeOperation = "source-over";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    setNoteMessage("");
  }

  async function saveCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setSaving(true);
    setNoteMessage("");
    try {
      await onSaveNote({
        locationId: location.locationId,
        userId: currentUser.userId,
        title: title || `${location.customerName ?? location.address} 手書きメモ`,
        dataUrl: canvas.toDataURL("image/png"),
      });
    } catch {
      setSaving(false);
      setNoteMessage("手書きメモの保存に失敗しました。");
      return;
    }

    setSaving(false);
    setTitle("");
    clearCanvas();
    setIsOpen(false);
    setNoteMessage("手書きメモを保存しました。");
    onNotesChanged(location.locationId);
  }

  async function deleteNote(note: HandwrittenNote) {
    const ok = window.confirm("この手書きメモを削除しますか？");
    if (!ok) return;

    try {
      await onDeleteNote(note, currentUser.userId);
    } catch {
      setNoteMessage("手書きメモの削除に失敗しました。");
      return;
    }

    setNoteMessage("手書きメモを削除しました。");
    onNotesChanged(location.locationId);
  }

  return (
    <div className="mt-5 border-t border-zinc-100 pt-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">手書きメモ</h3>
          <p className="mt-1 text-sm text-zinc-600">
            地点に紐づくPNGメモとして保存します。
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50"
          onClick={() => setIsOpen((value) => !value)}
        >
          {isOpen ? <X size={16} /> : <Brush size={16} />}
          {isOpen ? "閉じる" : "書く"}
        </button>
      </div>

      {isOpen ? (
        <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <input
            className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-emerald-600"
            value={title}
            placeholder="メモタイトル"
            onChange={(event) => setTitle(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${
                tool === "pen"
                  ? "border-emerald-700 bg-emerald-700 text-white"
                  : "border-zinc-300 bg-white"
              }`}
              onClick={() => setTool("pen")}
            >
              <Brush size={16} />
              ペン
            </button>
            <button
              type="button"
              className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${
                tool === "eraser"
                  ? "border-emerald-700 bg-emerald-700 text-white"
                  : "border-zinc-300 bg-white"
              }`}
              onClick={() => setTool("eraser")}
            >
              <Eraser size={16} />
              消しゴム
            </button>
            <button
              type="button"
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50"
              onClick={clearCanvas}
            >
              クリア
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
              disabled={saving}
              onClick={saveCanvas}
            >
              <Save size={16} />
              {saving ? "保存中" : "保存"}
            </button>
          </div>
          <canvas
            ref={canvasRef}
            width={680}
            height={360}
            className="h-[260px] w-full touch-none rounded-md border border-zinc-300 bg-white"
            onPointerDown={startDrawing}
            onPointerMove={draw}
            onPointerUp={stopDrawing}
            onPointerCancel={stopDrawing}
            aria-label="手書きメモキャンバス"
          />
        </div>
      ) : null}

      {noteMessage ? (
        <p className="mt-3 text-sm font-medium text-emerald-800">{noteMessage}</p>
      ) : null}

      <div className="mt-4 grid gap-3">
        {notesLoading ? (
          <p className="text-sm text-zinc-600">手書きメモを読み込み中です。</p>
        ) : null}
        {!notesLoading && notes.length === 0 ? (
          <p className="text-sm text-zinc-600">保存済みの手書きメモはありません。</p>
        ) : null}
        {notes.map((note) => (
          <div
            key={note.noteId}
            className="overflow-hidden rounded-md border border-zinc-200 bg-white"
          >
            <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {note.title ?? "手書きメモ"}
                </p>
                <p className="text-xs text-zinc-500">
                  {new Date(note.createdAt).toLocaleString("ja-JP")}
                </p>
              </div>
              <button
                type="button"
                className="grid size-8 place-items-center rounded-md border border-rose-200 text-rose-700 hover:bg-rose-50"
                onClick={() => deleteNote(note)}
                aria-label="手書きメモを削除"
              >
                <Trash2 size={15} />
              </button>
            </div>
            <a
              href={note.s3Key.startsWith("data:") ? note.s3Key : `/${note.s3Key}`}
              target="_blank"
              rel="noreferrer"
              className="block bg-zinc-50 p-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={note.s3Key.startsWith("data:") ? note.s3Key : `/${note.s3Key}`}
                alt={note.title ?? "手書きメモ"}
                className="h-auto max-h-44 w-full rounded border border-zinc-200 bg-white object-contain"
              />
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-3 border-b border-zinc-100 pb-2">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function LocationForm({
  currentUser,
  form,
  isEditing,
  message,
  duplicateCandidates,
  onChange,
  onCancel,
  onGeocodeAddress,
  onSubmit,
}: {
  currentUser: User;
  form: LocationFormState;
  isEditing: boolean;
  message: string;
  duplicateCandidates: DuplicateCandidate[];
  onChange: (form: LocationFormState) => void;
  onCancel: () => void;
  onGeocodeAddress: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const canAssign = currentUser.role === "admin";
  const hasLocation = form.lat !== "" && form.lng !== "";

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">{isEditing ? "地点編集" : "地点追加"}</h2>
        <Plus size={18} className="text-zinc-500" />
      </div>
      <form className="space-y-3" onSubmit={onSubmit}>
        <TextField
          label="顧客名"
          value={form.customerName}
          onChange={(value) => onChange({ ...form, customerName: value })}
        />
        <TextField
          label="住所"
          value={form.address}
          required
          onChange={(value) => onChange({ ...form, address: value })}
        />
        <DuplicateWarningList
          title="重複候補があります"
          candidates={duplicateCandidates}
        />
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-zinc-700">地図上の位置</p>
              <p className="mt-1 text-xs leading-5 text-zinc-600">
                住所から計算するか、地図をタップして指定します。
              </p>
            </div>
            <span
              className={`shrink-0 rounded px-2 py-1 text-xs font-semibold ${
                hasLocation
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {hasLocation ? "位置指定済み" : "未指定"}
            </span>
          </div>
          {hasLocation ? (
            <p className="mt-2 text-xs text-zinc-500">
              内部座標: {Number(form.lat).toFixed(5)}, {Number(form.lng).toFixed(5)}
            </p>
          ) : null}
          <button
            type="button"
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50"
            onClick={onGeocodeAddress}
          >
            <MapPin size={16} />
            住所から位置を計算
          </button>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-zinc-700">ステータス</span>
          <select
            className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 outline-none focus:border-emerald-600"
            value={form.status}
            onChange={(event) =>
              onChange({ ...form, status: event.target.value as LocationStatus })
            }
          >
            {locationStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-zinc-700">担当者</span>
          <select
            className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 outline-none focus:border-emerald-600 disabled:bg-zinc-100"
            value={form.assignedUserId}
            disabled={!canAssign}
            onChange={(event) =>
              onChange({ ...form, assignedUserId: event.target.value })
            }
          >
            {mockUsers
              .filter((user) => user.role === "sales")
              .map((user) => (
                <option key={user.userId} value={user.userId}>
                  {user.name}
                </option>
              ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="施工日"
            type="date"
            value={form.constructionDate}
            onChange={(value) => onChange({ ...form, constructionDate: value })}
          />
          <TextField
            label="点検予定日"
            type="date"
            value={form.nextInspectionDate}
            onChange={(value) => onChange({ ...form, nextInspectionDate: value })}
          />
        </div>
        <TextField
          label="タグ"
          value={form.tags}
          placeholder="定期点検, 施工済み"
          onChange={(value) => onChange({ ...form, tags: value })}
        />
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-zinc-700">メモ</span>
          <textarea
            className="min-h-20 w-full rounded-md border border-zinc-300 px-3 py-2 outline-none focus:border-emerald-600"
            value={form.memo}
            onChange={(event) => onChange({ ...form, memo: event.target.value })}
          />
        </label>
        {message ? <p className="text-sm font-medium text-emerald-800">{message}</p> : null}
        <div className="flex gap-2">
          <button
            type="submit"
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 py-2 font-semibold text-white hover:bg-emerald-800"
          >
            <CheckCircle2 size={16} />
            保存
          </button>
          <button
            type="button"
            className="rounded-md border border-zinc-300 px-3 py-2 font-medium hover:bg-zinc-50"
            onClick={onCancel}
          >
            取消
          </button>
        </div>
      </form>
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-zinc-700">{label}</span>
      <input
        className="h-10 w-full rounded-md border border-zinc-300 px-3 outline-none focus:border-emerald-600"
        value={value}
        type={type}
        required={required}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function LocationTable({
  locations,
  selectedId,
  onSelect,
}: {
  locations: Location[];
  selectedId: string | null;
  onSelect: (locationId: string) => void;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <h2 className="font-semibold">地点一覧</h2>
        <span className="text-sm text-zinc-500">{locations.length}件</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-4 py-3 font-medium">顧客名</th>
              <th className="px-4 py-3 font-medium">住所</th>
              <th className="px-4 py-3 font-medium">ステータス</th>
              <th className="px-4 py-3 font-medium">担当者</th>
              <th className="px-4 py-3 font-medium">次回点検</th>
            </tr>
          </thead>
          <tbody>
            {locations.map((location) => {
              const meta = getStatusMeta(location.status);
              return (
                <tr
                  key={location.locationId}
                  className={`cursor-pointer border-t border-zinc-100 hover:bg-emerald-50 ${
                    selectedId === location.locationId ? "bg-emerald-50" : ""
                  }`}
                  onClick={() => onSelect(location.locationId)}
                >
                  <td className="px-4 py-3 font-medium">
                    {location.customerName || "名称未設定"}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">{location.address}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded px-2 py-1 text-xs font-semibold text-white ${meta.color}`}
                    >
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {findUser(location.assignedUserId)?.name ?? "未割当"}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {location.nextInspectionDate ?? "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MiniStat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm text-zinc-600">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}
