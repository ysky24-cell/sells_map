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
  History,
  LogOut,
  MapPin,
  Maximize2,
  Minimize2,
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
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildAdminActionItems,
  type AdminActionItem,
} from "@/lib/admin-insights";
import {
  csvToLocations,
  locationsToCsv,
} from "@/lib/csv/locations-csv";
import {
  findDuplicateCandidates,
  findVisitWarningsForLocations,
} from "@/lib/duplicates";
import { mockGeocode, mockReverseGeocode, normalizeAddress } from "@/lib/geo";
import { optimizeRoutePoints } from "@/lib/route/mock-route-service";
import { getStatusMeta, locationStatusOptions } from "@/lib/status";
import { mockUsers, findUser } from "@/lib/users";
import {
  datetimeLocalToIso,
  formatVisitDateTime,
  toDatetimeLocal,
  toLocalDateString,
  visitResultLabel,
  visitResultOptions,
  visitResultToStatus,
} from "@/lib/visits";
import seedLocations from "../../data/locations.json";
import seedJaAreas from "../../data/ja-areas.json";
import seedMunicipalities from "../../data/municipalities.json";
import seedNotes from "../../data/notes.json";
import seedVisitPlanItems from "../../data/visit-plan-items.json";
import seedVisitPlans from "../../data/visit-plans.json";
import seedVisitRecords from "../../data/visit-records.json";
import type {
  AreaTracePoint,
  DuplicateCandidate,
  HandwrittenNote,
  JaArea,
  Location,
  LocationInput,
  LocationStatus,
  Municipality,
  OptimizedRoute,
  User,
  VisitPlan,
  VisitPlanItem,
  VisitPlanWithItems,
  VisitRecord,
  VisitRecordInput,
} from "@/types/domain";

type LocationFormState = {
  locationId?: string;
  customerName: string;
  address: string;
  lat: string;
  lng: string;
  status: LocationStatus;
  assignedUserId: string;
  areaId: string;
  municipalityId: string;
  constructionDate: string;
  lastVisitDate: string;
  nextInspectionDate: string;
  memo: string;
  tags: string;
};

type SalesKpiPeriod = "today" | "last7" | "last30" | "all";
type VisitTimeBand = "all" | "morning" | "afternoon" | "evening" | "unknown";

const emptyForm: LocationFormState = {
  customerName: "",
  address: "",
  lat: "",
  lng: "",
  status: "unvisited",
  assignedUserId: "sales-001",
  areaId: "area-setagaya",
  municipalityId: "muni-setagaya",
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
  visitRecords: "sales-map.visitRecords",
  jaAreas: "sales-map.jaAreas",
  municipalities: "sales-map.municipalities",
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

function readSeededRecords<T>(
  key: string,
  seed: T[],
  getId: (record: T) => string,
): T[] {
  const records = readLocalRecords<T>(key, seed);
  if (typeof window === "undefined") return records;

  const storedIds = new Set(records.map(getId));
  const missingSeedRecords = seed.filter((record) => !storedIds.has(getId(record)));
  if (missingSeedRecords.length === 0) return records;

  const merged = [...records, ...missingSeedRecords];
  writeLocalRecords(key, merged);
  return merged;
}

function nowIso() {
  return new Date().toISOString();
}

function listStoredLocations() {
  return readSeededRecords<Location>(
    storageKeys.locations,
    seedLocations as Location[],
    (location) => location.locationId,
  )
    .filter((location) => !location.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function listStoredJaAreas() {
  return readSeededRecords<JaArea>(
    storageKeys.jaAreas,
    seedJaAreas as JaArea[],
    (area) => area.areaId,
  )
    .filter((area) => area.active && !area.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

function listStoredMunicipalities() {
  return readSeededRecords<Municipality>(
    storageKeys.municipalities,
    seedMunicipalities as Municipality[],
    (municipality) => municipality.municipalityId,
  )
    .filter((municipality) => municipality.active && !municipality.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

function inferMunicipalityFromAddress(
  address: string,
  municipalities: Municipality[],
) {
  const normalized = normalizeAddress(address);
  return municipalities.find((municipality) =>
    normalized.includes(municipality.name),
  );
}

function municipalityForLocation(
  location: Location,
  municipalities: Municipality[],
) {
  return (
    municipalities.find(
      (municipality) => municipality.municipalityId === location.municipalityId,
    ) ?? inferMunicipalityFromAddress(location.address, municipalities)
  );
}

function areaForLocation(
  location: Location,
  jaAreas: JaArea[],
  municipalities: Municipality[],
) {
  const municipality = municipalityForLocation(location, municipalities);
  return (
    jaAreas.find((area) => area.areaId === location.areaId) ??
    jaAreas.find((area) => area.areaId === municipality?.areaId)
  );
}

function taxonomyForAddress(
  address: string,
  jaAreas: JaArea[],
  municipalities: Municipality[],
) {
  const municipality = inferMunicipalityFromAddress(address, municipalities);
  const area = jaAreas.find((item) => item.areaId === municipality?.areaId);
  return { area, municipality };
}

function listStoredNotes(locationId: string) {
  return readSeededRecords<HandwrittenNote>(
    storageKeys.notes,
    seedNotes as HandwrittenNote[],
    (note) => note.noteId,
  )
    .filter((note) => note.locationId === locationId && !note.deletedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function listStoredVisitRecords(locationId: string) {
  return readSeededRecords<VisitRecord>(
    storageKeys.visitRecords,
    seedVisitRecords as VisitRecord[],
    (record) => record.visitId,
  )
    .filter((record) => record.locationId === locationId)
    .sort((a, b) => b.visitedAt.localeCompare(a.visitedAt));
}

function listStoredAllVisitRecords() {
  return readSeededRecords<VisitRecord>(
    storageKeys.visitRecords,
    seedVisitRecords as VisitRecord[],
    (record) => record.visitId,
  ).sort((a, b) => b.visitedAt.localeCompare(a.visitedAt));
}

function listStoredAllVisitPlans() {
  return readSeededRecords<VisitPlan>(
    storageKeys.visitPlans,
    seedVisitPlans as VisitPlan[],
    (plan) => plan.planId,
  );
}

function listStoredAllVisitPlanItems() {
  return readSeededRecords<VisitPlanItem>(
    storageKeys.visitPlanItems,
    seedVisitPlanItems as VisitPlanItem[],
    (item) => item.planItemId,
  );
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
  const plans = listStoredAllVisitPlans();
  const items = listStoredAllVisitPlanItems();

  return plans
    .filter((plan) => !params.userId || plan.userId === params.userId)
    .filter((plan) => !params.date || plan.date === params.date)
    .map((plan) => withVisitPlanItems(plan, items))
    .sort(
      (a, b) =>
        b.items.length - a.items.length ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
}

function toDateString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function toFormState(
  location: Location,
  jaAreas: JaArea[],
  municipalities: Municipality[],
): LocationFormState {
  const municipality = municipalityForLocation(location, municipalities);
  const area = areaForLocation(location, jaAreas, municipalities);
  return {
    locationId: location.locationId,
    customerName: location.customerName ?? "",
    address: location.address,
    lat: String(location.lat),
    lng: String(location.lng),
    status: location.status,
    assignedUserId: location.assignedUserId ?? "sales-001",
    areaId: area?.areaId ?? location.areaId ?? "area-setagaya",
    municipalityId:
      municipality?.municipalityId ?? location.municipalityId ?? "muni-setagaya",
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
    areaId: form.areaId || undefined,
    municipalityId: form.municipalityId || undefined,
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
  const [jaAreas, setJaAreas] = useState<JaArea[]>([]);
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | LocationStatus>("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [municipalityFilter, setMunicipalityFilter] = useState("all");
  const [form, setForm] = useState<LocationFormState>(emptyForm);
  const [notes, setNotes] = useState<HandwrittenNote[]>([]);
  const [visitRecords, setVisitRecords] = useState<VisitRecord[]>([]);
  const [allVisitRecords, setAllVisitRecords] = useState<VisitRecord[]>([]);
  const [visitPlan, setVisitPlan] = useState<VisitPlanWithItems | null>(null);
  const [allVisitPlans, setAllVisitPlans] = useState<VisitPlanWithItems[]>([]);
  const [visitPlanDate, setVisitPlanDate] = useState(toDateString());
  const [visitPlanUserId, setVisitPlanUserId] = useState("sales-001");
  const [mapPlanSelectionMode, setMapPlanSelectionMode] = useState(false);
  const [mapSelectedLocationIds, setMapSelectedLocationIds] = useState<string[]>([]);
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  const [areaTraceMode, setAreaTraceMode] = useState(false);
  const [areaTraceAreaId, setAreaTraceAreaId] = useState("");
  const [areaTraceDraft, setAreaTraceDraft] = useState<AreaTracePoint[]>([]);
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

  function loadTaxonomy() {
    setJaAreas(listStoredJaAreas());
    setMunicipalities(listStoredMunicipalities());
  }

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(listStoredLocations()).then((storedLocations) => {
      if (!cancelled) {
          setLocations(storedLocations);
          setAllVisitRecords(listStoredAllVisitRecords());
          setAllVisitPlans(listStoredVisitPlans({}));
          setJaAreas(listStoredJaAreas());
          setMunicipalities(listStoredMunicipalities());
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

  async function loadVisitRecords(locationId: string) {
    setVisitRecords(listStoredVisitRecords(locationId));
    setAllVisitRecords(listStoredAllVisitRecords());
  }

  function refreshAllVisitPlans() {
    setAllVisitPlans(listStoredVisitPlans({}));
  }

  const effectiveVisitPlanUserId =
    currentUser?.role === "admin"
      ? visitPlanUserId
      : currentUser?.userId ?? visitPlanUserId;

  async function ensureVisitPlan() {
    const plans = listStoredAllVisitPlans();
    const items = listStoredAllVisitPlanItems();
    const existing = plans.find(
      (plan) =>
        plan.userId === effectiveVisitPlanUserId && plan.date === visitPlanDate,
    );

    if (existing) {
      const plan = withVisitPlanItems(existing, items);
      setVisitPlan(plan);
      refreshAllVisitPlans();
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
    refreshAllVisitPlans();
    setOptimizedRoute(null);
    return data.plan;
  }

  async function addLocationToVisitPlan(location: Location) {
    const plan = visitPlan ?? (await ensureVisitPlan());
    if (!plan) return;

    const items = listStoredAllVisitPlanItems();
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
    refreshAllVisitPlans();
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

    const items = listStoredAllVisitPlanItems();
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
    refreshAllVisitPlans();
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

  function beginAreaTrace(areaId: string) {
    if (!areaId) {
      setAdminMessage("JAエリアを選択してから境界をなぞってください。");
      return;
    }

    setAreaTraceAreaId(areaId);
    setAreaTraceDraft([]);
    setAreaTraceMode(true);
    setMapPlanSelectionMode(false);
    setAdminMessage(
      "地図上をドラッグしてJAエリア境界をなぞってください。描き終えたら管理者画面で保存します。",
    );
  }

  function cancelAreaTrace() {
    setAreaTraceMode(false);
    setAreaTraceDraft([]);
    setAdminMessage("JAエリア境界の下書きを破棄しました。");
  }

  function startAreaTrace(point: AreaTracePoint) {
    if (!areaTraceMode) return;
    setAreaTraceDraft([point]);
  }

  function appendAreaTrace(point: AreaTracePoint) {
    if (!areaTraceMode) return;
    setAreaTraceDraft((current) => {
      const lastPoint = current.at(-1);
      if (!lastPoint) return [point];
      if (areaTraceDistance(lastPoint, point) < 1.1) return current;
      return [...current, point];
    });
  }

  function finishAreaTrace() {
    if (!areaTraceMode) return;
    setAdminMessage(
      "JAエリア境界の下書きを作成しました。線を確認して、管理者画面で保存してください。",
    );
  }

  function saveAreaTrace(areaId: string) {
    if (!currentUser) return;
    if (!areaId) {
      setAdminMessage("保存するJAエリアを選択してください。");
      return;
    }
    if (areaTraceDraft.length < 3) {
      setAdminMessage("境界は地図上をドラッグして3点以上なぞってから保存してください。");
      return;
    }

    const storedAreas = readSeededRecords<JaArea>(
      storageKeys.jaAreas,
      seedJaAreas as JaArea[],
      (area) => area.areaId,
    );
    let didUpdate = false;
    const now = nowIso();
    const nextAreas = storedAreas.map((area) => {
      if (area.areaId !== areaId) return area;
      didUpdate = true;
      return {
        ...area,
        boundaryTrace: {
          points: normalizeAreaTracePoints(areaTraceDraft),
          source: "manual_trace" as const,
          updatedAt: now,
          updatedBy: currentUser.userId,
        },
        updatedAt: now,
      };
    });

    if (!didUpdate) {
      setAdminMessage("保存先のJAエリアが見つかりませんでした。");
      return;
    }

    writeLocalRecords(storageKeys.jaAreas, nextAreas);
    loadTaxonomy();
    setAreaTraceMode(false);
    setAreaTraceDraft([]);
    setAdminMessage("JAエリア境界を保存しました。営業画面の地図にも表示されます。");
  }

  function clearAreaTrace(areaId: string) {
    if (!currentUser) return;
    if (!areaId) {
      setAdminMessage("境界を削除するJAエリアを選択してください。");
      return;
    }

    const storedAreas = readSeededRecords<JaArea>(
      storageKeys.jaAreas,
      seedJaAreas as JaArea[],
      (area) => area.areaId,
    );
    let didUpdate = false;
    const now = nowIso();
    const nextAreas = storedAreas.map((area) => {
      if (area.areaId !== areaId) return area;
      didUpdate = true;
      return {
        ...area,
        boundaryTrace: undefined,
        updatedAt: now,
      };
    });

    if (!didUpdate) {
      setAdminMessage("境界を削除するJAエリアが見つかりませんでした。");
      return;
    }

    writeLocalRecords(storageKeys.jaAreas, nextAreas);
    loadTaxonomy();
    setAreaTraceMode(false);
    setAreaTraceDraft([]);
    setAdminMessage("JAエリア境界を削除しました。");
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

  async function saveVisitRecord(input: VisitRecordInput) {
    const storedRecords = readLocalRecords<VisitRecord>(
      storageKeys.visitRecords,
      seedVisitRecords as VisitRecord[],
    );
    const now = nowIso();
    const record: VisitRecord = {
      visitId: `visit-${crypto.randomUUID()}`,
      locationId: input.locationId,
      userId: input.userId,
      visitedAt: input.visitedAt,
      result: input.result,
      memo: input.memo?.trim() || undefined,
      nextActionDate: input.nextActionDate || undefined,
      createdAt: now,
      updatedAt: now,
    };

    writeLocalRecords(storageKeys.visitRecords, [record, ...storedRecords]);
    setAllVisitRecords(listStoredAllVisitRecords());

    const storedLocations = readLocalRecords<Location>(
      storageKeys.locations,
      seedLocations as Location[],
    );
    const index = storedLocations.findIndex(
      (location) => location.locationId === input.locationId,
    );
    const nextStatus = visitResultToStatus(input.result);
    if (index >= 0) {
      const currentLocation = storedLocations[index];
      const keepConstructed =
        currentLocation.status === "constructed" &&
        (input.result === "visited" || input.result === "revisit");
      storedLocations[index] = {
        ...currentLocation,
        status: keepConstructed || !nextStatus ? currentLocation.status : nextStatus,
        lastVisitDate: toLocalDateString(input.visitedAt),
        updatedBy: input.userId,
        updatedAt: now,
      };
      writeLocalRecords(storageKeys.locations, storedLocations);
      await loadLocations(false);
    }

    setSelectedId(input.locationId);
    await loadVisitRecords(input.locationId);
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
    const allItems = listStoredAllVisitPlanItems();
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
    refreshAllVisitPlans();
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
    const allItems = listStoredAllVisitPlanItems().map((item) =>
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
    refreshAllVisitPlans();
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
    const allItems = listStoredAllVisitPlanItems().map((item) =>
      item.planId === visitPlan.planId && orderMap.has(item.locationId)
        ? {
            ...item,
            order: orderMap.get(item.locationId) ?? item.order,
            updatedAt: nowIso(),
          }
        : item,
    );
    const allPlans = listStoredAllVisitPlans().map((plan) =>
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
    refreshAllVisitPlans();
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

  const visibleJaAreas = useMemo(() => {
    if (!currentUser || currentUser.role === "admin") return jaAreas;
    return jaAreas.filter((area) => currentUser.assignedAreaIds.includes(area.areaId));
  }, [currentUser, jaAreas]);

  const visibleMunicipalities = useMemo(() => {
    const visibleAreaIds = new Set(visibleJaAreas.map((area) => area.areaId));
    return municipalities.filter((municipality) =>
      visibleAreaIds.has(municipality.areaId),
    );
  }, [municipalities, visibleJaAreas]);
  const selectedTraceAreaId = areaTraceAreaId || jaAreas[0]?.areaId || "";
  const activeAreaTraceMode =
    currentUser?.role === "admin" && areaTraceMode && Boolean(selectedTraceAreaId);

  const filteredLocations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return visibleByRole.filter((location) => {
      const area = areaForLocation(location, jaAreas, municipalities);
      const municipality = municipalityForLocation(location, municipalities);
      const matchesQuery =
        !normalizedQuery ||
        [
          location.customerName,
          location.address,
          area?.name,
          municipality?.name,
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
      const matchesArea = areaFilter === "all" || area?.areaId === areaFilter;
      const matchesMunicipality =
        municipalityFilter === "all" ||
        municipality?.municipalityId === municipalityFilter;

      return (
        matchesQuery &&
        matchesStatus &&
        matchesAssignee &&
        matchesArea &&
        matchesMunicipality
      );
    });
  }, [
    areaFilter,
    assigneeFilter,
    jaAreas,
    municipalities,
    municipalityFilter,
    query,
    statusFilter,
    visibleByRole,
  ]);

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
          setVisitRecords([]);
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
          setVisitRecords(listStoredVisitRecords(selectedLocationId));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedLocationId]);

  useEffect(() => {
    if (!isMapFullscreen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMapFullscreen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMapFullscreen]);

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
    const availableAreas =
      currentUser?.role === "sales"
        ? jaAreas.filter((area) => currentUser.assignedAreaIds.includes(area.areaId))
        : jaAreas;
    const defaultAreaId =
      availableAreas[0]?.areaId ?? jaAreas[0]?.areaId ?? emptyForm.areaId;
    const defaultMunicipalityId =
      municipalities.find((municipality) => municipality.areaId === defaultAreaId)
        ?.municipalityId ??
      municipalities[0]?.municipalityId ??
      emptyForm.municipalityId;
    setForm({
      ...emptyForm,
      assignedUserId:
        currentUser?.role === "sales" ? currentUser.userId : emptyForm.assignedUserId,
      areaId: defaultAreaId,
      municipalityId: defaultMunicipalityId,
    });
    setIsEditing(false);
  }

  function startEdit(location: Location) {
    setForm(toFormState(location, jaAreas, municipalities));
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
    const taxonomy = taxonomyForAddress(
      result.normalizedAddress ?? trimmedAddress,
      jaAreas,
      municipalities,
    );

    setForm((current) => ({
      ...current,
      address: result.normalizedAddress ?? trimmedAddress,
      lat: result.lat.toFixed(6),
      lng: result.lng.toFixed(6),
      areaId: taxonomy.area?.areaId ?? current.areaId,
      municipalityId: taxonomy.municipality?.municipalityId ?? current.municipalityId,
    }));
    setMessage("住所から位置を計算しました。");
    return result;
  }

  function setFormLocationFromMap(point: { lat: number; lng: number }) {
    const reverseGeocoded = mockReverseGeocode(point, locations);
    const shouldReplaceAddress =
      !form.address ||
      form.address.startsWith("地図タップ地点") ||
      form.address.includes("地図選択・番地要確認");
    const taxonomy = taxonomyForAddress(
      reverseGeocoded.address,
      jaAreas,
      municipalities,
    );
    setForm((current) => ({
      ...current,
      lat: point.lat.toFixed(6),
      lng: point.lng.toFixed(6),
      address:
        !current.address ||
        current.address.startsWith("地図タップ地点") ||
        current.address.includes("地図選択・番地要確認")
          ? reverseGeocoded.address
          : current.address,
      areaId:
        shouldReplaceAddress && taxonomy.area ? taxonomy.area.areaId : current.areaId,
      municipalityId:
        shouldReplaceAddress && taxonomy.municipality
          ? taxonomy.municipality.municipalityId
          : current.municipalityId,
    }));
    setMessage(
      !shouldReplaceAddress
        ? "地図タップで位置を指定しました。入力済みの住所はそのままです。必要に応じて修正してください。"
        : reverseGeocoded.confidence === "nearby_location"
        ? "地図タップで位置を指定し、近くの住所候補を入れました。正確な番地はお客さま確認後に修正してください。"
        : "地図タップで位置を指定し、住所候補を仮入力しました。正確な住所はお客さま確認後に修正してください。",
    );
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

  function createJaArea(input: { name: string; code: string; memo: string }) {
    if (!currentUser) return;
    const name = input.name.trim();
    if (!name) {
      setAdminMessage("JAエリア名を入力してください。");
      return;
    }

    const storedAreas = readLocalRecords<JaArea>(
      storageKeys.jaAreas,
      seedJaAreas as JaArea[],
    );
    const exists = storedAreas.some(
      (area) => !area.deletedAt && area.name.trim() === name,
    );
    if (exists) {
      setAdminMessage("同じJAエリア名がすでに登録されています。");
      return;
    }

    const now = nowIso();
    const area: JaArea = {
      areaId: `area-${crypto.randomUUID()}`,
      name,
      code: input.code.trim() || undefined,
      memo: input.memo.trim() || undefined,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    writeLocalRecords(storageKeys.jaAreas, [...storedAreas, area]);
    loadTaxonomy();
    setAdminMessage(`${area.name} を登録しました。`);
  }

  function createMunicipality(input: {
    areaId: string;
    prefecture: string;
    name: string;
  }) {
    if (!currentUser) return;
    const name = input.name.trim();
    const area = jaAreas.find((item) => item.areaId === input.areaId);
    if (!area || !name) {
      setAdminMessage("JAエリアと市町村名を入力してください。");
      return;
    }

    const storedMunicipalities = readLocalRecords<Municipality>(
      storageKeys.municipalities,
      seedMunicipalities as Municipality[],
    );
    const exists = storedMunicipalities.some(
      (municipality) =>
        !municipality.deletedAt &&
        municipality.areaId === input.areaId &&
        municipality.name.trim() === name,
    );
    if (exists) {
      setAdminMessage("同じJAエリア内に同じ市町村がすでに登録されています。");
      return;
    }

    const now = nowIso();
    const municipality: Municipality = {
      municipalityId: `muni-${crypto.randomUUID()}`,
      areaId: area.areaId,
      prefecture: input.prefecture.trim() || "東京都",
      name,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    writeLocalRecords(storageKeys.municipalities, [
      ...storedMunicipalities,
      municipality,
    ]);
    loadTaxonomy();
    setAdminMessage(`${area.name} に ${municipality.name} を登録しました。`);
  }

  if (!currentUser) {
    return (
      <LoginScreen
        onLogin={(user) => {
          setCurrentUser(user);
          setQuery("");
          setStatusFilter("all");
          setAssigneeFilter("all");
          setAreaFilter("all");
          setMunicipalityFilter("all");
        }}
      />
    );
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
                setQuery("");
                setStatusFilter("all");
                setAssigneeFilter("all");
                setAreaFilter("all");
                setMunicipalityFilter("all");
                resetForm();
              }}
            >
              <LogOut size={16} />
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid min-w-0 max-w-7xl gap-5 px-4 py-5 xl:grid-cols-[320px_1fr]">
        <aside className="min-w-0 space-y-5">
          <DashboardPanel
            currentUser={currentUser}
            dashboard={dashboard}
            locations={visibleByRole}
            jaAreas={visibleJaAreas}
            municipalities={visibleMunicipalities}
          />
          <LocationForm
            currentUser={currentUser}
            form={form}
            jaAreas={jaAreas}
            municipalities={municipalities}
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

        <section className="min-w-0 space-y-5">
          <FilterBar
            query={query}
            statusFilter={statusFilter}
            assigneeFilter={assigneeFilter}
            areaFilter={areaFilter}
            municipalityFilter={municipalityFilter}
            jaAreas={visibleJaAreas}
            municipalities={visibleMunicipalities}
            onQueryChange={setQuery}
            onStatusChange={setStatusFilter}
            onAssigneeChange={setAssigneeFilter}
            onAreaChange={(areaId) => {
              setAreaFilter(areaId);
              setMunicipalityFilter("all");
            }}
            onMunicipalityChange={setMunicipalityFilter}
          />

          {currentUser.role === "admin" ? (
            <AdminPanel
              locations={locations}
              visitRecords={allVisitRecords}
              visitPlans={allVisitPlans}
              jaAreas={jaAreas}
              municipalities={municipalities}
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
              onCreateJaArea={createJaArea}
              onCreateMunicipality={createMunicipality}
              areaTraceMode={activeAreaTraceMode}
              selectedTraceAreaId={selectedTraceAreaId}
              areaTraceDraftCount={areaTraceDraft.length}
              onTraceAreaChange={setAreaTraceAreaId}
              onStartAreaTrace={beginAreaTrace}
              onCancelAreaTrace={cancelAreaTrace}
              onSaveAreaTrace={saveAreaTrace}
              onClearAreaTrace={clearAreaTrace}
            />
          ) : null}

          <div className="grid min-w-0 gap-5 lg:grid-cols-[1fr_360px]">
            <MockMap
              locations={filteredLocations}
              jaAreas={jaAreas}
              municipalities={municipalities}
              selectedId={selectedLocation?.locationId ?? null}
              planSelectionMode={mapPlanSelectionMode}
              planSelectedLocationIds={mapSelectedLocationIds}
              routeLocationIds={optimizedRoute?.orderedPointIds ?? []}
              areaTraceMode={activeAreaTraceMode}
              areaTraceAreaId={selectedTraceAreaId}
              areaTraceDraft={areaTraceDraft}
              onSelect={setSelectedId}
              onTogglePlanSelection={toggleMapPlanSelection}
              onMapPick={setFormLocationFromMap}
              onAreaTraceStart={startAreaTrace}
              onAreaTraceAppend={appendAreaTrace}
              onAreaTraceEnd={finishAreaTrace}
              onOpenFullscreen={() => setIsMapFullscreen(true)}
              isLoading={isLoading}
            />
            <LocationDetail
              location={selectedLocation}
              currentUser={currentUser}
              jaAreas={jaAreas}
              municipalities={municipalities}
              notes={notes}
              visitRecords={visitRecords}
              notesLoading={notesLoading}
              onEdit={startEdit}
              onDelete={deleteLocation}
              onNotesChanged={(locationId) => loadNotes(locationId)}
              onSaveNote={saveHandwrittenNote}
              onDeleteNote={deleteHandwrittenNote}
              onSaveVisitRecord={saveVisitRecord}
            />
          </div>

          <LocationTable
            locations={filteredLocations}
            jaAreas={jaAreas}
            municipalities={municipalities}
            selectedId={selectedLocation?.locationId ?? null}
            onSelect={setSelectedId}
          />
        </section>
      </div>

      {isMapFullscreen ? (
        <div className="fixed inset-0 z-50 bg-[#f7f7f2] p-3 sm:p-5">
          <div className="flex h-full flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-3 shadow-sm">
              <div>
                <p className="text-sm font-medium text-zinc-500">
                  地図作業モード
                </p>
                <h2 className="text-lg font-semibold">
                  {mapPlanSelectionMode
                    ? `訪問予定の地点を選択中: ${mapSelectedLocationIds.length}件`
                    : selectedLocation
                      ? selectedLocation.customerName ?? selectedLocation.address
                      : "地点を選択できます"}
                </h2>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
                onClick={() => setIsMapFullscreen(false)}
              >
                <Minimize2 size={16} />
                通常画面に戻る
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <MockMap
                locations={filteredLocations}
                jaAreas={jaAreas}
                municipalities={municipalities}
                selectedId={selectedLocation?.locationId ?? null}
                planSelectionMode={mapPlanSelectionMode}
                planSelectedLocationIds={mapSelectedLocationIds}
                routeLocationIds={optimizedRoute?.orderedPointIds ?? []}
                areaTraceMode={activeAreaTraceMode}
                areaTraceAreaId={selectedTraceAreaId}
                areaTraceDraft={areaTraceDraft}
                onSelect={setSelectedId}
                onTogglePlanSelection={toggleMapPlanSelection}
                onMapPick={setFormLocationFromMap}
                onAreaTraceStart={startAreaTrace}
                onAreaTraceAppend={appendAreaTrace}
                onAreaTraceEnd={finishAreaTrace}
                onCloseFullscreen={() => setIsMapFullscreen(false)}
                isFullscreen
                isLoading={isLoading}
              />
            </div>
          </div>
        </div>
      ) : null}
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
  jaAreas,
  municipalities,
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
  jaAreas: JaArea[];
  municipalities: Municipality[];
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
      {currentUser.role === "sales" ? (
        <div className="mt-4 rounded-md border border-emerald-100 bg-emerald-50 p-3">
          <p className="text-sm font-semibold text-emerald-950">担当JAエリア</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {jaAreas.map((area) => (
              <span
                key={area.areaId}
                className="rounded bg-white px-2 py-1 text-xs font-medium text-emerald-900"
              >
                {area.name}
              </span>
            ))}
          </div>
          <p className="mt-3 text-sm font-semibold text-emerald-950">
            表示市町村
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {municipalities.map((municipality) => (
              <span
                key={municipality.municipalityId}
                className="rounded bg-white px-2 py-1 text-xs font-medium text-emerald-900"
              >
                {municipality.prefecture}
                {municipality.name}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function AdminPanel({
  locations,
  visitRecords,
  visitPlans,
  jaAreas,
  municipalities,
  duplicateCandidates,
  message,
  onExportCsv,
  onImportCsv,
  onCreateJaArea,
  onCreateMunicipality,
  areaTraceMode,
  selectedTraceAreaId,
  areaTraceDraftCount,
  onTraceAreaChange,
  onStartAreaTrace,
  onCancelAreaTrace,
  onSaveAreaTrace,
  onClearAreaTrace,
}: {
  locations: Location[];
  visitRecords: VisitRecord[];
  visitPlans: VisitPlanWithItems[];
  jaAreas: JaArea[];
  municipalities: Municipality[];
  duplicateCandidates: DuplicateCandidate[];
  message: string;
  onExportCsv: () => void;
  onImportCsv: (event: ChangeEvent<HTMLInputElement>) => void;
  onCreateJaArea: (input: { name: string; code: string; memo: string }) => void;
  onCreateMunicipality: (input: {
    areaId: string;
    prefecture: string;
    name: string;
  }) => void;
  areaTraceMode: boolean;
  selectedTraceAreaId: string;
  areaTraceDraftCount: number;
  onTraceAreaChange: (areaId: string) => void;
  onStartAreaTrace: (areaId: string) => void;
  onCancelAreaTrace: () => void;
  onSaveAreaTrace: (areaId: string) => void;
  onClearAreaTrace: (areaId: string) => void;
}) {
  const [areaForm, setAreaForm] = useState({ name: "", code: "", memo: "" });
  const [municipalityForm, setMunicipalityForm] = useState({
    areaId: jaAreas[0]?.areaId ?? "",
    prefecture: "東京都",
    name: "",
  });
  const selectedMunicipalityAreaId =
    municipalityForm.areaId || jaAreas[0]?.areaId || "";
  const selectedTraceArea =
    jaAreas.find((area) => area.areaId === selectedTraceAreaId) ?? jaAreas[0];
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
  const actionItems = buildAdminActionItems(
    locations,
    visitRecords,
    toDateString(),
  ).slice(0, 8);
  const severityStyles = {
    high: "border-rose-200 bg-rose-50 text-rose-950",
    medium: "border-amber-200 bg-amber-50 text-amber-950",
    low: "border-sky-200 bg-sky-50 text-sky-950",
  } satisfies Record<AdminActionItem["severity"], string>;

  return (
    <>
      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} />
            <h2 className="font-semibold">システム管理ダッシュボード</h2>
          </div>
          <p className="mt-1 text-sm text-zinc-600">
            地点データ、担当範囲、CSV、JAエリア境界などの運用設定を管理します。
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

      <div className="mt-4 rounded-md border border-zinc-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">JAエリア・市町村管理</h3>
            <p className="mt-1 text-sm text-zinc-600">
              営業担当者の担当範囲として使うJAエリアと、その中の市町村を登録します。
            </p>
          </div>
          <span className="rounded bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-700">
            {jaAreas.length}エリア / {municipalities.length}市町村
          </span>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <form
            className="rounded-md border border-zinc-100 bg-zinc-50 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              onCreateJaArea(areaForm);
              if (areaForm.name.trim()) {
                setAreaForm({ name: "", code: "", memo: "" });
              }
            }}
          >
            <p className="text-sm font-semibold text-zinc-800">JAエリア登録</p>
            <div className="mt-3 grid gap-2">
              <input
                className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-emerald-600"
                value={areaForm.name}
                placeholder="例: JA東京中央 世田谷エリア"
                onChange={(event) =>
                  setAreaForm((current) => ({ ...current, name: event.target.value }))
                }
              />
              <input
                className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-emerald-600"
                value={areaForm.code}
                placeholder="エリアコード 任意"
                onChange={(event) =>
                  setAreaForm((current) => ({ ...current, code: event.target.value }))
                }
              />
              <input
                className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-emerald-600"
                value={areaForm.memo}
                placeholder="メモ 任意"
                onChange={(event) =>
                  setAreaForm((current) => ({ ...current, memo: event.target.value }))
                }
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                <Plus size={16} />
                エリアを登録
              </button>
            </div>
          </form>

          <form
            className="rounded-md border border-zinc-100 bg-zinc-50 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              onCreateMunicipality({
                ...municipalityForm,
                areaId: selectedMunicipalityAreaId,
              });
              if (municipalityForm.name.trim()) {
                setMunicipalityForm((current) => ({ ...current, name: "" }));
              }
            }}
          >
            <p className="text-sm font-semibold text-zinc-800">市町村登録</p>
            <div className="mt-3 grid gap-2">
              <select
                className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-emerald-600"
                value={selectedMunicipalityAreaId}
                onChange={(event) =>
                  setMunicipalityForm((current) => ({
                    ...current,
                    areaId: event.target.value,
                  }))
                }
              >
                {jaAreas.map((area) => (
                  <option key={area.areaId} value={area.areaId}>
                    {area.name}
                  </option>
                ))}
              </select>
              <input
                className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-emerald-600"
                value={municipalityForm.prefecture}
                placeholder="都道府県"
                onChange={(event) =>
                  setMunicipalityForm((current) => ({
                    ...current,
                    prefecture: event.target.value,
                  }))
                }
              />
              <input
                className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-emerald-600"
                value={municipalityForm.name}
                placeholder="例: 世田谷区"
                onChange={(event) =>
                  setMunicipalityForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                <Plus size={16} />
                市町村を登録
              </button>
            </div>
          </form>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-md bg-white p-3">
            <p className="text-xs font-semibold text-zinc-500">登録済みJAエリア</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {jaAreas.map((area) => (
                <span
                  key={area.areaId}
                  className="rounded bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-800"
                >
                  {area.name}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-md bg-white p-3">
            <p className="text-xs font-semibold text-zinc-500">登録済み市町村</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {municipalities.map((municipality) => (
                <span
                  key={municipality.municipalityId}
                  className="rounded bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-800"
                >
                  {municipality.prefecture}
                  {municipality.name}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-md border border-dashed border-emerald-300 bg-emerald-50/60 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-emerald-950">
                JAエリア境界を地図でなぞる
              </p>
              <p className="mt-1 text-sm leading-6 text-emerald-900">
                JA独自の区分を、緯度経度ではなく地図上の手書き境界として保存します。
              </p>
            </div>
            <span className="rounded bg-white px-2 py-1 text-xs font-semibold text-emerald-950">
              保存済み {selectedTraceArea?.boundaryTrace?.points.length ?? 0}点 /
              下書き {areaTraceDraftCount}点
            </span>
          </div>

          <div className="mt-3 grid gap-2 lg:grid-cols-[1fr_auto]">
            <select
              className="h-10 rounded-md border border-emerald-200 bg-white px-3 text-sm outline-none focus:border-emerald-700"
              value={selectedTraceAreaId}
              onChange={(event) => onTraceAreaChange(event.target.value)}
              disabled={jaAreas.length === 0}
            >
              {jaAreas.map((area) => (
                <option key={area.areaId} value={area.areaId}>
                  {area.name}
                </option>
              ))}
            </select>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                onClick={() => onStartAreaTrace(selectedTraceAreaId)}
                disabled={!selectedTraceAreaId}
              >
                <Brush size={16} />
                {areaTraceMode ? "なぞり直す" : "地図でなぞる"}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md border border-emerald-700 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-400"
                onClick={() => onSaveAreaTrace(selectedTraceAreaId)}
                disabled={!selectedTraceAreaId || areaTraceDraftCount < 3}
              >
                <Save size={16} />
                保存
              </button>
              {areaTraceMode ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
                  onClick={onCancelAreaTrace}
                >
                  <X size={16} />
                  中止
                </button>
              ) : null}
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-zinc-400"
                onClick={() => onClearAreaTrace(selectedTraceAreaId)}
                disabled={!selectedTraceAreaId}
              >
                <Eraser size={16} />
                境界を消す
              </button>
            </div>
          </div>

          {areaTraceMode ? (
            <p className="mt-2 rounded bg-white px-3 py-2 text-xs font-medium text-emerald-950">
              地図上でドラッグすると境界線の下書きが作られます。描き終えたらこの「保存」を押してください。
            </p>
          ) : null}
        </div>
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">要対応・データ品質チェック</h3>
          <span className="rounded bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-700">
            {actionItems.length}件
          </span>
        </div>
        {actionItems.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600">
            現在、優先対応が必要な地点はありません。
          </p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {actionItems.map((item) => (
              <li
                key={item.id}
                className={`rounded-md border px-3 py-2 text-sm ${severityStyles[item.severity]}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{item.title}</span>
                  <span className="text-xs">
                    {item.severity === "high"
                      ? "高"
                      : item.severity === "medium"
                        ? "中"
                        : "低"}
                  </span>
                </div>
                <p className="mt-1 leading-6">{item.description}</p>
              </li>
            ))}
          </ul>
        )}
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

      <SalesKpiDashboard
        locations={locations}
        visitRecords={visitRecords}
        visitPlans={visitPlans}
        jaAreas={jaAreas}
        municipalities={municipalities}
      />
    </>
  );
}

const salesKpiPeriodOptions = [
  { value: "today", label: "本日" },
  { value: "last7", label: "直近7日" },
  { value: "last30", label: "直近30日" },
  { value: "all", label: "全期間" },
] satisfies { value: SalesKpiPeriod; label: string }[];

const visitTimeBandOptions = [
  { value: "all", label: "すべての時間帯" },
  { value: "morning", label: "午前" },
  { value: "afternoon", label: "午後" },
  { value: "evening", label: "夕方以降" },
  { value: "unknown", label: "未設定" },
] satisfies { value: VisitTimeBand; label: string }[];

type SalesKpiVisitContext = {
  record: VisitRecord;
  location: Location;
  area?: JaArea;
  municipality?: Municipality;
  timeBand: Exclude<VisitTimeBand, "all">;
};

type SalesKpiPlanContext = {
  plan: VisitPlanWithItems;
  item: VisitPlanItem;
  location: Location;
  area?: JaArea;
  municipality?: Municipality;
  timeBand: Exclude<VisitTimeBand, "all">;
};

type SalesKpiBreakdownRow = {
  label: string;
  visits: number;
  nextActions: number;
  prospects: number;
  contracts: number;
  nextActionRate: number;
};

function SalesKpiDashboard({
  locations,
  visitRecords,
  visitPlans,
  jaAreas,
  municipalities,
}: {
  locations: Location[];
  visitRecords: VisitRecord[];
  visitPlans: VisitPlanWithItems[];
  jaAreas: JaArea[];
  municipalities: Municipality[];
}) {
  const [periodFilter, setPeriodFilter] = useState<SalesKpiPeriod>("last30");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [municipalityFilter, setMunicipalityFilter] = useState("all");
  const [timeBandFilter, setTimeBandFilter] = useState<VisitTimeBand>("all");

  const locationMap = useMemo(
    () => new Map(locations.map((location) => [location.locationId, location])),
    [locations],
  );
  const availableMunicipalities = useMemo(
    () =>
      areaFilter === "all"
        ? municipalities
        : municipalities.filter((municipality) => municipality.areaId === areaFilter),
    [areaFilter, municipalities],
  );

  const matchesSharedFilters = useCallback((params: {
    userId: string;
    area?: JaArea;
    municipality?: Municipality;
    timeBand: Exclude<VisitTimeBand, "all">;
  }) => {
    const matchesAssignee =
      assigneeFilter === "all" || params.userId === assigneeFilter;
    const matchesArea = areaFilter === "all" || params.area?.areaId === areaFilter;
    const matchesMunicipality =
      municipalityFilter === "all" ||
      params.municipality?.municipalityId === municipalityFilter;
    const matchesTimeBand =
      timeBandFilter === "all" || params.timeBand === timeBandFilter;

    return matchesAssignee && matchesArea && matchesMunicipality && matchesTimeBand;
  }, [areaFilter, assigneeFilter, municipalityFilter, timeBandFilter]);

  const filteredVisitContexts = useMemo(
    () =>
      visitRecords
        .map((record): SalesKpiVisitContext | null => {
          const location = locationMap.get(record.locationId);
          if (!location) return null;
          return {
            record,
            location,
            area: areaForLocation(location, jaAreas, municipalities),
            municipality: municipalityForLocation(location, municipalities),
            timeBand: visitTimeBandForDateTime(record.visitedAt),
          };
        })
        .filter((context): context is SalesKpiVisitContext => Boolean(context))
        .filter((context) =>
          isDateKeyInSalesKpiPeriod(
            toDateString(new Date(context.record.visitedAt)),
            periodFilter,
          ),
        )
        .filter((context) =>
          matchesSharedFilters({
            userId: context.record.userId,
            area: context.area,
            municipality: context.municipality,
            timeBand: context.timeBand,
          }),
        ),
    [
      jaAreas,
      locationMap,
      matchesSharedFilters,
      municipalities,
      periodFilter,
      visitRecords,
    ],
  );

  const filteredPlanContexts = useMemo(
    () =>
      visitPlans
        .filter((plan) => isDateKeyInSalesKpiPeriod(plan.date, periodFilter))
        .flatMap((plan) =>
          plan.items.map((item): SalesKpiPlanContext | null => {
            const location = locationMap.get(item.locationId);
            if (!location) return null;
            return {
              plan,
              item,
              location,
              area: areaForLocation(location, jaAreas, municipalities),
              municipality: municipalityForLocation(location, municipalities),
              timeBand: visitTimeBandForPlanItem(item),
            };
          }),
        )
        .filter((context): context is SalesKpiPlanContext => Boolean(context))
        .filter((context) =>
          matchesSharedFilters({
            userId: context.plan.userId,
            area: context.area,
            municipality: context.municipality,
            timeBand: context.timeBand,
          }),
        ),
    [
      jaAreas,
      locationMap,
      matchesSharedFilters,
      municipalities,
      periodFilter,
      visitPlans,
    ],
  );

  const recordedLocationIds = new Set(
    filteredVisitContexts.map((context) => context.location.locationId),
  );
  const completedPlannedVisits = filteredPlanContexts.filter((context) =>
    recordedLocationIds.has(context.location.locationId),
  ).length;
  const nextActionCount = filteredVisitContexts.filter(
    (context) => Boolean(context.record.nextActionDate),
  ).length;
  const timeWindowCount = filteredPlanContexts.filter(
    (context) => Boolean(context.item.preferredTimeWindow),
  ).length;
  const contractedCount = filteredVisitContexts.filter(
    (context) => context.record.result === "contracted",
  ).length;
  const prospectCount = filteredVisitContexts.filter((context) =>
    ["prospect", "contracted"].includes(context.record.result),
  ).length;
  const absentCount = filteredVisitContexts.filter(
    (context) => context.record.result === "absent",
  ).length;
  const lostCount = filteredVisitContexts.filter(
    (context) => context.record.result === "lost",
  ).length;
  const plannedCount = filteredPlanContexts.length;
  const visitRecordCount = filteredVisitContexts.length;

  const controlKpis = [
    {
      label: "訪問予定数",
      value: `${plannedCount}件`,
      note: "地図選択・予定作成で増やせる行動量",
    },
    {
      label: "訪問記録数",
      value: `${visitRecordCount}件`,
      note: "訪問後に入力できた活動量",
    },
    {
      label: "予定消化率",
      value: formatPercent(completedPlannedVisits, plannedCount),
      note: `${completedPlannedVisits}/${plannedCount}件を訪問記録済み`,
    },
    {
      label: "次アクション設定率",
      value: formatPercent(nextActionCount, visitRecordCount),
      note: `${nextActionCount}/${visitRecordCount}件に次回予定あり`,
    },
    {
      label: "時間帯指定率",
      value: formatPercent(timeWindowCount, plannedCount),
      note: "訪問時間帯を事前に置けている割合",
    },
  ];
  const resultKpis = [
    {
      label: "成約率",
      value: formatPercent(contractedCount, visitRecordCount),
      note: `${contractedCount}件成約`,
    },
    {
      label: "見込み化率",
      value: formatPercent(prospectCount, visitRecordCount),
      note: `${prospectCount}件が見込み・成約`,
    },
    {
      label: "不在率",
      value: formatPercent(absentCount, visitRecordCount),
      note: `${absentCount}件が不在`,
    },
    {
      label: "失注率",
      value: formatPercent(lostCount, visitRecordCount),
      note: `${lostCount}件が失注`,
    },
  ];
  const areaBreakdownRows = buildSalesKpiBreakdownRows(
    filteredVisitContexts,
    (context) => context.area?.name ?? "JAエリア未設定",
  );
  const municipalityBreakdownRows = buildSalesKpiBreakdownRows(
    filteredVisitContexts,
    (context) =>
      context.municipality
        ? `${context.municipality.prefecture}${context.municipality.name}`
        : "市町村未設定",
  );
  const timeBandBreakdownRows = buildSalesKpiBreakdownRows(
    filteredVisitContexts,
    (context) => visitTimeBandLabel(context.timeBand),
  );

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 size={18} />
            <h2 className="font-semibold">営業KPI管理ダッシュボード</h2>
          </div>
          <p className="mt-1 text-sm leading-6 text-zinc-600">
            営業担当者が自分で動かせる行動KPIを先に確認し、成約率などの結果KPIは補助指標として見ます。
          </p>
        </div>
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          集計更新は1時間単位。位置情報は機微情報のため、個人のリアルタイム追跡ではなく
          エリア・市町村・時間帯単位で扱います。
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-zinc-700">期間</span>
          <select
            className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 outline-none focus:border-emerald-600"
            value={periodFilter}
            onChange={(event) =>
              setPeriodFilter(event.target.value as SalesKpiPeriod)
            }
          >
            {salesKpiPeriodOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-zinc-700">担当者</span>
          <select
            className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 outline-none focus:border-emerald-600"
            value={assigneeFilter}
            onChange={(event) => setAssigneeFilter(event.target.value)}
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
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-zinc-700">JAエリア</span>
          <select
            className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 outline-none focus:border-emerald-600"
            value={areaFilter}
            onChange={(event) => {
              const nextAreaId = event.target.value;
              setAreaFilter(nextAreaId);
              if (
                municipalityFilter !== "all" &&
                !municipalities.some(
                  (municipality) =>
                    municipality.municipalityId === municipalityFilter &&
                    (nextAreaId === "all" || municipality.areaId === nextAreaId),
                )
              ) {
                setMunicipalityFilter("all");
              }
            }}
          >
            <option value="all">すべてのJAエリア</option>
            {jaAreas.map((area) => (
              <option key={area.areaId} value={area.areaId}>
                {area.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-zinc-700">市町村</span>
          <select
            className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 outline-none focus:border-emerald-600"
            value={municipalityFilter}
            onChange={(event) => setMunicipalityFilter(event.target.value)}
          >
            <option value="all">すべての市町村</option>
            {availableMunicipalities.map((municipality) => (
              <option
                key={municipality.municipalityId}
                value={municipality.municipalityId}
              >
                {municipality.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-zinc-700">訪問時間帯</span>
          <select
            className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 outline-none focus:border-emerald-600"
            value={timeBandFilter}
            onChange={(event) =>
              setTimeBandFilter(event.target.value as VisitTimeBand)
            }
          >
            {visitTimeBandOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
        最終集計目安: {hourlyKpiUpdateLabel()} / KPI対象:
        訪問予定 {plannedCount}件、訪問記録 {visitRecordCount}件
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-semibold">営業コントロールKPI</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {controlKpis.map((kpi) => (
            <KpiMetricCard key={kpi.label} {...kpi} tone="control" />
          ))}
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-semibold">結果KPI 補助指標</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {resultKpis.map((kpi) => (
            <KpiMetricCard key={kpi.label} {...kpi} tone="result" />
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        <SalesKpiBreakdownTable
          title="JAエリア別"
          rows={areaBreakdownRows}
        />
        <SalesKpiBreakdownTable
          title="市町村別"
          rows={municipalityBreakdownRows}
        />
        <SalesKpiBreakdownTable
          title="訪問時間帯別"
          rows={timeBandBreakdownRows}
        />
      </div>
    </section>
  );
}

function KpiMetricCard({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: "control" | "result";
}) {
  const toneClass =
    tone === "control"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : "border-zinc-200 bg-zinc-50 text-zinc-900";

  return (
    <div className={`rounded-md border p-3 ${toneClass}`}>
      <p className="text-xs font-semibold">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      <p className="mt-2 text-xs leading-5 opacity-80">{note}</p>
    </div>
  );
}

function SalesKpiBreakdownTable({
  title,
  rows,
}: {
  title: string;
  rows: SalesKpiBreakdownRow[];
}) {
  return (
    <div className="rounded-md border border-zinc-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="rounded bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-700">
          {rows.length}件
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-600">条件に合う訪問記録はありません。</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="pb-2 pr-3 font-medium">区分</th>
                <th className="pb-2 pr-3 font-medium">訪問</th>
                <th className="pb-2 pr-3 font-medium">次アクション</th>
                <th className="pb-2 pr-3 font-medium">見込み</th>
                <th className="pb-2 font-medium">成約</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 6).map((row) => (
                <tr key={row.label} className="border-b border-zinc-100 last:border-0">
                  <td className="max-w-40 truncate py-2 pr-3 font-medium text-zinc-900">
                    {row.label}
                  </td>
                  <td className="py-2 pr-3 text-zinc-700">{row.visits}</td>
                  <td className="py-2 pr-3 text-zinc-700">
                    {formatPercent(row.nextActions, row.visits)}
                  </td>
                  <td className="py-2 pr-3 text-zinc-700">{row.prospects}</td>
                  <td className="py-2 text-zinc-700">{row.contracts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function buildSalesKpiBreakdownRows(
  contexts: SalesKpiVisitContext[],
  labelForContext: (context: SalesKpiVisitContext) => string,
): SalesKpiBreakdownRow[] {
  const rows = new Map<string, SalesKpiBreakdownRow>();
  contexts.forEach((context) => {
    const label = labelForContext(context);
    const current =
      rows.get(label) ??
      {
        label,
        visits: 0,
        nextActions: 0,
        prospects: 0,
        contracts: 0,
        nextActionRate: 0,
      };

    current.visits += 1;
    if (context.record.nextActionDate) current.nextActions += 1;
    if (["prospect", "contracted"].includes(context.record.result)) {
      current.prospects += 1;
    }
    if (context.record.result === "contracted") current.contracts += 1;
    current.nextActionRate = current.visits
      ? Math.round((current.nextActions / current.visits) * 100)
      : 0;
    rows.set(label, current);
  });

  return [...rows.values()].sort(
    (a, b) =>
      b.visits - a.visits ||
      b.nextActionRate - a.nextActionRate ||
      a.label.localeCompare(b.label, "ja"),
  );
}

function addDaysToDateKey(dateKey: string, offsetDays: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function isDateKeyInSalesKpiPeriod(dateKey: string, period: SalesKpiPeriod) {
  if (period === "all") return true;
  const today = toDateString();
  if (period === "today") return dateKey === today;
  const startDate = addDaysToDateKey(today, period === "last7" ? -6 : -29);
  return dateKey >= startDate && dateKey <= today;
}

function visitTimeBandForDateTime(dateTime: string): Exclude<VisitTimeBand, "all"> {
  const hour = new Date(dateTime).getHours();
  if (Number.isNaN(hour)) return "unknown";
  return visitTimeBandForHour(hour);
}

function visitTimeBandForPlanItem(
  item: VisitPlanItem,
): Exclude<VisitTimeBand, "all"> {
  const start = item.preferredTimeWindow?.start;
  if (!start) return "unknown";
  const hour = Number(start.split(":")[0]);
  if (Number.isNaN(hour)) return "unknown";
  return visitTimeBandForHour(hour);
}

function visitTimeBandForHour(hour: number): Exclude<VisitTimeBand, "all"> {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function visitTimeBandLabel(timeBand: Exclude<VisitTimeBand, "all">) {
  return (
    visitTimeBandOptions.find((option) => option.value === timeBand)?.label ??
    "未設定"
  );
}

function formatPercent(numerator: number, denominator: number) {
  if (denominator <= 0) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function hourlyKpiUpdateLabel(date = new Date()) {
  const rounded = new Date(date);
  rounded.setMinutes(0, 0, 0);
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(rounded);
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

  const nextPlannedLocation = sortedItems
    .map((item) => locationForItem(item.locationId))
    .find((location): location is Location => Boolean(location));
  const routeMinutes = optimizedRoute?.totalDurationSeconds
    ? Math.max(1, Math.round(optimizedRoute.totalDurationSeconds / 60))
    : null;

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

        <div className="rounded-md border border-emerald-100 bg-emerald-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-emerald-950">
              今日の作業サマリー
            </p>
            <span className="rounded bg-white px-2 py-1 text-xs font-semibold text-emerald-900">
              {sortedItems.length}件
            </span>
          </div>
          <div className="mt-3 grid gap-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-emerald-900">次の訪問先</span>
              <span className="max-w-40 truncate font-semibold text-emerald-950">
                {nextPlannedLocation?.customerName ??
                  nextPlannedLocation?.address ??
                  "未設定"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-emerald-900">ルート</span>
              <span className="font-semibold text-emerald-950">
                {optimizedRoute
                  ? `${((optimizedRoute.totalDistanceMeters ?? 0) / 1000).toFixed(
                      1,
                    )}km / ${routeMinutes}分`
                  : sortedItems.length >= 2
                    ? "未最適化"
                    : "訪問先追加待ち"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-emerald-900">地図選択中</span>
              <span className="font-semibold text-emerald-950">
                {mapSelectedLocationIds.length}件
              </span>
            </div>
          </div>
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
  areaFilter,
  municipalityFilter,
  jaAreas,
  municipalities,
  onQueryChange,
  onStatusChange,
  onAssigneeChange,
  onAreaChange,
  onMunicipalityChange,
}: {
  query: string;
  statusFilter: "all" | LocationStatus;
  assigneeFilter: string;
  areaFilter: string;
  municipalityFilter: string;
  jaAreas: JaArea[];
  municipalities: Municipality[];
  onQueryChange: (value: string) => void;
  onStatusChange: (value: "all" | LocationStatus) => void;
  onAssigneeChange: (value: string) => void;
  onAreaChange: (value: string) => void;
  onMunicipalityChange: (value: string) => void;
}) {
  const municipalityOptions =
    areaFilter === "all"
      ? municipalities
      : municipalities.filter((municipality) => municipality.areaId === areaFilter);
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 lg:grid-cols-[1fr_190px_190px_190px_190px]">
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
          <MapPin
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            size={18}
          />
          <select
            className="h-11 w-full appearance-none rounded-md border border-zinc-300 bg-white pl-10 pr-3 text-sm outline-none focus:border-emerald-600"
            value={areaFilter}
            onChange={(event) => onAreaChange(event.target.value)}
          >
            <option value="all">すべてのJAエリア</option>
            {jaAreas.map((area) => (
              <option key={area.areaId} value={area.areaId}>
                {area.name}
              </option>
            ))}
          </select>
        </label>
        <label className="relative">
          <MapPin
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            size={18}
          />
          <select
            className="h-11 w-full appearance-none rounded-md border border-zinc-300 bg-white pl-10 pr-3 text-sm outline-none focus:border-emerald-600"
            value={municipalityFilter}
            onChange={(event) => onMunicipalityChange(event.target.value)}
          >
            <option value="all">すべての市町村</option>
            {municipalityOptions.map((municipality) => (
              <option
                key={municipality.municipalityId}
                value={municipality.municipalityId}
              >
                {municipality.name}
              </option>
            ))}
          </select>
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
  jaAreas,
  municipalities,
  selectedId,
  planSelectionMode,
  planSelectedLocationIds,
  routeLocationIds,
  areaTraceMode = false,
  areaTraceAreaId,
  areaTraceDraft = [],
  onSelect,
  onTogglePlanSelection,
  onMapPick,
  onAreaTraceStart,
  onAreaTraceAppend,
  onAreaTraceEnd,
  onOpenFullscreen,
  onCloseFullscreen,
  isFullscreen = false,
  isLoading,
}: {
  locations: Location[];
  jaAreas: JaArea[];
  municipalities: Municipality[];
  selectedId: string | null;
  planSelectionMode: boolean;
  planSelectedLocationIds: string[];
  routeLocationIds: string[];
  areaTraceMode?: boolean;
  areaTraceAreaId?: string;
  areaTraceDraft?: AreaTracePoint[];
  onSelect: (locationId: string) => void;
  onTogglePlanSelection: (locationId: string) => void;
  onMapPick: (point: { lat: number; lng: number }) => void;
  onAreaTraceStart?: (point: AreaTracePoint) => void;
  onAreaTraceAppend?: (point: AreaTracePoint) => void;
  onAreaTraceEnd?: () => void;
  onOpenFullscreen?: () => void;
  onCloseFullscreen?: () => void;
  isFullscreen?: boolean;
  isLoading: boolean;
}) {
  const [hoveredLocationId, setHoveredLocationId] = useState<string | null>(null);
  const [closedPopupLocationId, setClosedPopupLocationId] = useState<string | null>(
    null,
  );
  const isTracingAreaRef = useRef(false);
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
    if (planSelectionMode || areaTraceMode) return;
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
    setClosedPopupLocationId(selectedId);
  }

  function pointFromTracePointer(event: PointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return normalizeAreaTracePoint({
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    });
  }

  function handleAreaTracePointerDown(event: PointerEvent<HTMLElement>) {
    if (!areaTraceMode || !onAreaTraceStart) return;
    event.preventDefault();
    event.stopPropagation();
    isTracingAreaRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setClosedPopupLocationId(selectedId);
    onAreaTraceStart(pointFromTracePointer(event));
  }

  function handleAreaTracePointerMove(event: PointerEvent<HTMLElement>) {
    if (!areaTraceMode || !isTracingAreaRef.current || !onAreaTraceAppend) return;
    event.preventDefault();
    event.stopPropagation();
    onAreaTraceAppend(pointFromTracePointer(event));
  }

  function finishAreaTracePointer(event: PointerEvent<HTMLElement>) {
    if (!areaTraceMode || !isTracingAreaRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    isTracingAreaRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onAreaTraceEnd?.();
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
  const popupLocationId =
    hoveredLocationId ??
    (selectedId && selectedId !== closedPopupLocationId ? selectedId : null);
  const popupLocation =
    locations.find((location) => location.locationId === popupLocationId) ?? null;
  const popupPosition = popupLocation ? positionFor(popupLocation) : null;
  const tracedAreas = jaAreas
    .map((area, index) => ({
      area,
      index,
      points: area.boundaryTrace?.points ?? [],
    }))
    .filter(({ points }) => points.length >= 3);
  const activeTraceArea = jaAreas.find((area) => area.areaId === areaTraceAreaId);
  const mapStatusText = isLoading
    ? "読み込み中"
    : areaTraceMode
      ? `${activeTraceArea?.name ?? "JAエリア"} の境界をなぞり中`
      : planSelectionMode
        ? `${locations.length}件表示・ピンを複数選択`
        : `${locations.length}件表示・地図タップで位置指定`;

  return (
    <section
      className={`relative min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-[#e9efe7] shadow-sm ${
        isFullscreen ? "h-full min-h-[520px]" : "min-h-[520px]"
      } ${
        areaTraceMode
          ? "cursor-crosshair touch-none"
          : planSelectionMode
            ? "cursor-default"
            : "cursor-crosshair"
      }`}
      onClick={handleMapClick}
      onPointerDown={handleAreaTracePointerDown}
      onPointerMove={handleAreaTracePointerMove}
      onPointerUp={finishAreaTracePointer}
      onPointerCancel={finishAreaTracePointer}
    >
      <div className="absolute inset-0 grid grid-cols-6 grid-rows-6 opacity-50">
        {Array.from({ length: 36 }).map((_, index) => (
          <div key={index} className="border border-white/70" />
        ))}
      </div>
      <div className="absolute left-0 right-0 top-[18%] h-3 rotate-[-7deg] bg-white/80" />
      <div className="absolute left-[-5%] right-[-5%] top-[55%] h-4 rotate-[12deg] bg-white/80" />
      <div className="absolute bottom-0 left-[18%] top-0 w-4 rotate-[6deg] bg-white/80" />
      {tracedAreas.length > 0 || areaTraceDraft.length >= 2 ? (
        <svg
          className="pointer-events-none absolute inset-0 z-10 size-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {tracedAreas.map(({ area, index, points }) => {
            const color = areaTraceColor(index);
            const centroid = areaTraceCentroid(points);
            const isActive = area.areaId === areaTraceAreaId;
            return (
              <g key={area.areaId}>
                <polygon
                  points={areaTraceSvgPoints(points)}
                  fill={color.fill}
                  fillOpacity={isActive ? 0.24 : 0.16}
                  stroke={color.stroke}
                  strokeWidth={isActive ? 0.85 : 0.55}
                  strokeLinejoin="round"
                />
                <text
                  x={centroid.x}
                  y={centroid.y}
                  textAnchor="middle"
                  className="fill-zinc-900 text-[3px] font-bold"
                  paintOrder="stroke"
                  stroke="white"
                  strokeWidth="0.6"
                >
                  {area.name}
                </text>
              </g>
            );
          })}
          {areaTraceDraft.length >= 3 ? (
            <polygon
              points={areaTraceSvgPoints(areaTraceDraft)}
              fill="#059669"
              fillOpacity="0.18"
              stroke="#065f46"
              strokeWidth="0.95"
              strokeLinejoin="round"
            />
          ) : null}
          {areaTraceDraft.length >= 2 ? (
            <polyline
              points={areaTraceSvgPoints(areaTraceDraft)}
              fill="none"
              stroke="#064e3b"
              strokeWidth="1.35"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="1.6 1.1"
            />
          ) : null}
        </svg>
      ) : null}
      {routeLocations.length >= 2 ? (
        <svg
          className="pointer-events-none absolute inset-0 z-10 size-full"
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
        className="absolute inset-x-4 top-4 z-30 flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white/95 px-3 py-2 text-sm shadow-sm"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="font-medium">MockMapProvider</span>
        <span className="text-zinc-500">{mapStatusText}</span>
        {isFullscreen ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-1 font-medium hover:bg-zinc-50"
            onClick={onCloseFullscreen}
            aria-label="地図を戻す"
          >
            <Minimize2 size={15} />
            戻す
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-1 font-medium hover:bg-zinc-50"
            onClick={onOpenFullscreen}
            aria-label="地図を全画面にする"
          >
            <Maximize2 size={15} />
            全画面
          </button>
        )}
      </div>

      {planSelectionMode ? (
        <div
          className="absolute left-4 top-16 z-30 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 shadow-sm"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          訪問予定に入れる地点を地図上で選択中: {planSelectedLocationIds.length}件
        </div>
      ) : null}

      {areaTraceMode ? (
        <div
          className="absolute left-4 top-16 z-30 max-w-[calc(100%-32px)] rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-950 shadow-sm"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          地図上をドラッグしてJAエリア境界をなぞります。下書き {areaTraceDraft.length}点
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
              if (areaTraceMode) return;
              setClosedPopupLocationId(null);
              if (planSelectionMode) {
                onTogglePlanSelection(location.locationId);
              } else {
                onSelect(location.locationId);
              }
            }}
            onMouseEnter={() => setHoveredLocationId(location.locationId)}
            onMouseLeave={() => setHoveredLocationId(null)}
            onFocus={() => setHoveredLocationId(location.locationId)}
            onBlur={() => setHoveredLocationId(null)}
            className={`absolute z-20 grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 text-xs font-bold text-white shadow-lg transition hover:scale-110 ${
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

      {popupLocation && popupPosition ? (
        <MapLocationPopup
          location={popupLocation}
          area={areaForLocation(popupLocation, jaAreas, municipalities)}
          municipality={municipalityForLocation(popupLocation, municipalities)}
          isPlanSelected={planSelectedLocationIds.includes(
            popupLocation.locationId,
          )}
          position={popupPosition}
          onClose={() => {
            setHoveredLocationId(null);
            setClosedPopupLocationId(popupLocation.locationId);
          }}
        />
      ) : null}

      <div
        className="absolute bottom-4 left-4 right-4 z-30 flex flex-wrap gap-2 rounded-md border border-zinc-200 bg-white/95 p-3 shadow-sm"
        onPointerDown={(event) => event.stopPropagation()}
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

function clampPercent(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const areaTracePalette = [
  { fill: "#10b981", stroke: "#047857" },
  { fill: "#38bdf8", stroke: "#0369a1" },
  { fill: "#f59e0b", stroke: "#b45309" },
  { fill: "#a78bfa", stroke: "#6d28d9" },
  { fill: "#f472b6", stroke: "#be185d" },
] as const;

function normalizeAreaTracePoint(point: AreaTracePoint): AreaTracePoint {
  return {
    x: Number(clampPercent(point.x, 0, 100).toFixed(2)),
    y: Number(clampPercent(point.y, 0, 100).toFixed(2)),
  };
}

function normalizeAreaTracePoints(points: AreaTracePoint[]) {
  return points.map(normalizeAreaTracePoint);
}

function areaTraceDistance(start: AreaTracePoint, end: AreaTracePoint) {
  return Math.hypot(start.x - end.x, start.y - end.y);
}

function areaTraceSvgPoints(points: AreaTracePoint[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function areaTraceCentroid(points: AreaTracePoint[]) {
  if (points.length === 0) return { x: 50, y: 50 };
  const total = points.reduce(
    (sum, point) => ({
      x: sum.x + point.x,
      y: sum.y + point.y,
    }),
    { x: 0, y: 0 },
  );
  return {
    x: total.x / points.length,
    y: total.y / points.length,
  };
}

function areaTraceColor(index: number) {
  return areaTracePalette[index % areaTracePalette.length];
}

function MapLocationPopup({
  location,
  area,
  municipality,
  isPlanSelected,
  position,
  onClose,
}: {
  location: Location;
  area?: JaArea;
  municipality?: Municipality;
  isPlanSelected: boolean;
  position: { x: number; y: number };
  onClose: () => void;
}) {
  const meta = getStatusMeta(location.status);
  const user = findUser(location.assignedUserId);
  const showBelow = position.y < 42;
  const left = clampPercent(position.x, 19, 81);
  const top = clampPercent(position.y, 18, 82);

  return (
    <div
      className="absolute z-30 w-[min(280px,calc(100%-32px))] rounded-md border border-zinc-200 bg-white p-3 text-sm shadow-xl"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        transform: showBelow
          ? "translate(-50%, 18px)"
          : "translate(-50%, calc(-100% - 18px))",
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className={`absolute left-1/2 size-3 -translate-x-1/2 rotate-45 border-zinc-200 bg-white ${
          showBelow
            ? "-top-[7px] border-l border-t"
            : "-bottom-[7px] border-b border-r"
        }`}
        aria-hidden="true"
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-zinc-950">
            {location.customerName || "名称未設定"}
          </p>
          <p className="mt-1 text-xs leading-5 text-zinc-600">
            {location.address}
          </p>
        </div>
        <button
          type="button"
          className="grid size-7 shrink-0 place-items-center rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-50"
          onClick={onClose}
          aria-label="ポップアップを閉じる"
        >
          <X size={14} />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span
          className={`inline-flex rounded px-2 py-1 text-xs font-semibold text-white ${meta.color}`}
        >
          {meta.label}
        </span>
        {isPlanSelected ? (
          <span className="inline-flex rounded bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-900">
            訪問予定選択中
          </span>
        ) : null}
      </div>
      <dl className="mt-3 grid gap-2 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-zinc-500">担当</dt>
          <dd className="truncate font-medium text-zinc-800">
            {user?.name ?? "未割当"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-zinc-500">JA</dt>
          <dd className="truncate font-medium text-zinc-800">
            {area?.name ?? "未設定"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-zinc-500">市町村</dt>
          <dd className="truncate font-medium text-zinc-800">
            {municipality
              ? `${municipality.prefecture}${municipality.name}`
              : "未設定"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-zinc-500">最終訪問</dt>
          <dd className="font-medium text-zinc-800">
            {location.lastVisitDate ?? "-"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-zinc-500">点検予定</dt>
          <dd className="font-medium text-zinc-800">
            {location.nextInspectionDate ?? "-"}
          </dd>
        </div>
      </dl>
      {location.memo ? (
        <p className="mt-3 line-clamp-2 rounded bg-zinc-50 px-2 py-1.5 text-xs leading-5 text-zinc-600">
          {location.memo}
        </p>
      ) : null}
    </div>
  );
}

function LocationDetail({
  location,
  currentUser,
  jaAreas,
  municipalities,
  notes,
  visitRecords,
  notesLoading,
  onEdit,
  onDelete,
  onNotesChanged,
  onSaveNote,
  onDeleteNote,
  onSaveVisitRecord,
}: {
  location: Location | null;
  currentUser: User;
  jaAreas: JaArea[];
  municipalities: Municipality[];
  notes: HandwrittenNote[];
  visitRecords: VisitRecord[];
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
  onSaveVisitRecord: (input: VisitRecordInput) => Promise<void>;
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
  const area = areaForLocation(location, jaAreas, municipalities);
  const municipality = municipalityForLocation(location, municipalities);

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
        <DetailRow label="JAエリア" value={area?.name ?? "未設定"} />
        <DetailRow
          label="市町村"
          value={
            municipality
              ? `${municipality.prefecture}${municipality.name}`
              : "未設定"
          }
        />
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

      <VisitRecordsSection
        key={location.locationId}
        currentUser={currentUser}
        location={location}
        records={visitRecords}
        onSaveVisitRecord={onSaveVisitRecord}
      />

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

function VisitRecordsSection({
  currentUser,
  location,
  records,
  onSaveVisitRecord,
}: {
  currentUser: User;
  location: Location;
  records: VisitRecord[];
  onSaveVisitRecord: (input: VisitRecordInput) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [visitedAt, setVisitedAt] = useState(toDatetimeLocal());
  const [result, setResult] = useState<VisitRecord["result"]>("visited");
  const [nextActionDate, setNextActionDate] = useState("");
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [recordMessage, setRecordMessage] = useState("");

  async function submitVisitRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setRecordMessage("");
    const formElements = event.currentTarget.elements;
    const submittedVisitedAt =
      (
        formElements.namedItem("visitedAt") as HTMLInputElement | null
      )?.value.trim() || visitedAt;
    const submittedResult =
      ((
        formElements.namedItem("result") as HTMLSelectElement | null
      )?.value.trim() as VisitRecord["result"]) ||
      result;
    const submittedNextActionDate =
      (
        formElements.namedItem("nextActionDate") as HTMLInputElement | null
      )?.value.trim() || nextActionDate;
    const submittedMemo =
      (
        formElements.namedItem("memo") as HTMLTextAreaElement | null
      )?.value.trim() || memo.trim();

    try {
      await onSaveVisitRecord({
        locationId: location.locationId,
        userId: currentUser.userId,
        visitedAt: datetimeLocalToIso(submittedVisitedAt),
        result: submittedResult,
        memo: submittedMemo || undefined,
        nextActionDate: submittedNextActionDate || undefined,
      });
    } catch {
      setSaving(false);
      setRecordMessage("訪問記録の保存に失敗しました。");
      return;
    }

    setSaving(false);
    setVisitedAt(toDatetimeLocal());
    setResult("visited");
    setNextActionDate("");
    setMemo("");
    setIsOpen(false);
    setRecordMessage("訪問記録を保存しました。");
  }

  return (
    <div className="mt-5 border-t border-zinc-100 pt-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <History size={17} />
            <h3 className="font-semibold">訪問履歴</h3>
          </div>
          <p className="mt-1 text-sm text-zinc-600">
            訪問結果を残すと、最終訪問日と地点ステータスも更新されます。
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50"
          onClick={() => setIsOpen((value) => !value)}
        >
          {isOpen ? <X size={16} /> : <Plus size={16} />}
          {isOpen ? "閉じる" : "記録追加"}
        </button>
      </div>

      {recordMessage ? (
        <p className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
          {recordMessage}
        </p>
      ) : null}

      {isOpen ? (
        <form
          className="mb-4 space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-3"
          onSubmit={submitVisitRecord}
        >
          <label className="grid gap-1 text-sm font-medium">
            訪問日時
            <input
              name="visitedAt"
              className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-emerald-600"
              type="datetime-local"
              value={visitedAt}
              onInput={(event) => setVisitedAt(event.currentTarget.value)}
              onChange={(event) => setVisitedAt(event.target.value)}
              required
            />
          </label>

          <label className="grid gap-1 text-sm font-medium">
            結果
            <select
              name="result"
              className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-emerald-600"
              value={result}
              onChange={(event) =>
                setResult(event.target.value as VisitRecord["result"])
              }
            >
              {visitResultOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm font-medium">
            次回アクション日
            <input
              name="nextActionDate"
              className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-emerald-600"
              type="date"
              value={nextActionDate}
              onInput={(event) => setNextActionDate(event.currentTarget.value)}
              onChange={(event) => setNextActionDate(event.target.value)}
            />
          </label>

          <label className="grid gap-1 text-sm font-medium">
            メモ
            <textarea
              name="memo"
              className="min-h-20 rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-600"
              value={memo}
              onInput={(event) => setMemo(event.currentTarget.value)}
              onChange={(event) => setMemo(event.target.value)}
              placeholder="会話内容、次に確認すること、注意事項"
            />
          </label>

          <button
            type="submit"
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
            disabled={saving}
          >
            <Save size={16} />
            {saving ? "保存中" : "訪問記録を保存"}
          </button>
        </form>
      ) : null}

      {records.length === 0 ? (
        <p className="rounded-md bg-zinc-50 px-3 py-3 text-sm text-zinc-600">
          まだ訪問履歴はありません。
        </p>
      ) : (
        <ul className="space-y-3">
          {records.slice(0, 8).map((record) => {
            const status = visitResultToStatus(record.result) ?? "visited";
            const meta = getStatusMeta(status);
            const user = findUser(record.userId);
            return (
              <li
                key={record.visitId}
                className="rounded-md border border-zinc-200 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className="rounded px-2 py-1 text-xs font-semibold text-white"
                    style={{ backgroundColor: meta.marker }}
                  >
                    {visitResultLabel(record.result)}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {formatVisitDateTime(record.visitedAt)}
                  </span>
                </div>
                <div className="mt-2 text-sm text-zinc-600">
                  担当: {user?.name ?? "未設定"}
                </div>
                {record.memo ? (
                  <p className="mt-2 text-sm leading-6 text-zinc-700">
                    {record.memo}
                  </p>
                ) : null}
                {record.nextActionDate ? (
                  <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-950">
                    次回アクション: {record.nextActionDate}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
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
  jaAreas,
  municipalities,
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
  jaAreas: JaArea[];
  municipalities: Municipality[];
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
  const hasApproximateAddress = form.address.includes("地図選択・番地要確認");
  const areaOptions =
    currentUser.role === "admin"
      ? jaAreas
      : jaAreas.filter(
          (area) =>
            currentUser.assignedAreaIds.includes(area.areaId) ||
            area.areaId === form.areaId,
        );
  const municipalityOptions = municipalities.filter(
    (municipality) => municipality.areaId === form.areaId,
  );

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
        {hasApproximateAddress ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            地図タップから入れた仮住所です。正確な住所・番地はお客さま確認後に修正してください。
          </p>
        ) : null}
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
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-zinc-700">JAエリア</span>
          <select
            className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 outline-none focus:border-emerald-600"
            value={form.areaId}
            onChange={(event) => {
              const nextAreaId = event.target.value;
              const nextMunicipalityId =
                municipalities.find(
                  (municipality) => municipality.areaId === nextAreaId,
                )?.municipalityId ?? "";
              onChange({
                ...form,
                areaId: nextAreaId,
                municipalityId: nextMunicipalityId,
              });
            }}
          >
            {areaOptions.length === 0 ? (
              <option value="">JAエリア未登録</option>
            ) : null}
            {areaOptions.map((area) => (
              <option key={area.areaId} value={area.areaId}>
                {area.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-zinc-700">市町村</span>
          <select
            className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 outline-none focus:border-emerald-600"
            value={form.municipalityId}
            onChange={(event) =>
              onChange({ ...form, municipalityId: event.target.value })
            }
          >
            {municipalityOptions.length === 0 ? (
              <option value="">市町村未登録</option>
            ) : null}
            {municipalityOptions.map((municipality) => (
              <option
                key={municipality.municipalityId}
                value={municipality.municipalityId}
              >
                {municipality.prefecture}
                {municipality.name}
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
  jaAreas,
  municipalities,
  selectedId,
  onSelect,
}: {
  locations: Location[];
  jaAreas: JaArea[];
  municipalities: Municipality[];
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
        <table className="w-full min-w-[1040px] text-left text-sm">
          <thead className="bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-4 py-3 font-medium">顧客名</th>
              <th className="px-4 py-3 font-medium">JAエリア</th>
              <th className="px-4 py-3 font-medium">市町村</th>
              <th className="px-4 py-3 font-medium">住所</th>
              <th className="px-4 py-3 font-medium">ステータス</th>
              <th className="px-4 py-3 font-medium">担当者</th>
              <th className="px-4 py-3 font-medium">次回点検</th>
            </tr>
          </thead>
          <tbody>
            {locations.map((location) => {
              const meta = getStatusMeta(location.status);
              const area = areaForLocation(location, jaAreas, municipalities);
              const municipality = municipalityForLocation(location, municipalities);
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
                  <td className="px-4 py-3 text-zinc-700">
                    {area?.name ?? "未設定"}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {municipality ? municipality.name : "未設定"}
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
