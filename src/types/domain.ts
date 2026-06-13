export type UserRole = "admin" | "sales";

export type User = {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  assignedAreaIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type AreaTracePoint = {
  x: number;
  y: number;
};

export type AreaTrace = {
  points: AreaTracePoint[];
  source: "manual_trace";
  updatedAt: string;
  updatedBy?: string;
};

export type JaArea = {
  areaId: string;
  name: string;
  code?: string;
  memo?: string;
  boundaryTrace?: AreaTrace;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

export type Municipality = {
  municipalityId: string;
  areaId: string;
  prefecture: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

export type LocationStatus =
  | "unvisited"
  | "visited"
  | "absent"
  | "prospect"
  | "contracted"
  | "constructed"
  | "inspection_due"
  | "do_not_visit"
  | "lost";

export type Location = {
  locationId: string;
  customerName?: string;
  address: string;
  normalizedAddress?: string;
  lat: number;
  lng: number;
  status: LocationStatus;
  assignedUserId?: string;
  areaId?: string;
  municipalityId?: string;
  constructionDate?: string;
  lastVisitDate?: string;
  nextInspectionDate?: string;
  memo?: string;
  tags?: string[];
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

export type VisitRecord = {
  visitId: string;
  locationId: string;
  userId: string;
  visitedAt: string;
  result:
    | "visited"
    | "absent"
    | "revisit"
    | "prospect"
    | "contracted"
    | "lost"
    | "do_not_visit";
  memo?: string;
  nextActionDate?: string;
  createdAt: string;
  updatedAt: string;
};

export type VisitRecordInput = {
  locationId: string;
  userId: string;
  visitedAt: string;
  result: VisitRecord["result"];
  memo?: string;
  nextActionDate?: string;
};

export type HandwrittenNote = {
  noteId: string;
  locationId: string;
  userId: string;
  s3Key: string;
  mimeType: "image/png" | "image/svg+xml";
  title?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

export type HandwrittenNoteInput = {
  locationId: string;
  userId: string;
  title?: string;
  dataUrl: string;
  mimeType: "image/png" | "image/svg+xml";
};

export type VisitPlan = {
  planId: string;
  userId: string;
  date: string;
  startLocation?: {
    lat: number;
    lng: number;
    label: string;
  };
  endLocation?: {
    lat: number;
    lng: number;
    label: string;
  };
  status: "draft" | "optimized" | "completed";
  memo?: string;
  createdAt: string;
  updatedAt: string;
};

export type VisitPlanItem = {
  planItemId: string;
  planId: string;
  locationId: string;
  order: number;
  priority?: "low" | "medium" | "high";
  preferredTimeWindow?: {
    start: string;
    end: string;
  };
  memo?: string;
  createdAt: string;
  updatedAt: string;
};

export type VisitPlanWithItems = VisitPlan & {
  items: VisitPlanItem[];
};

export type VisitPlanInput = {
  userId: string;
  date: string;
  memo?: string;
};

export type VisitPlanItemInput = {
  locationId: string;
  priority?: "low" | "medium" | "high";
  preferredTimeWindow?: {
    start: string;
    end: string;
  };
  memo?: string;
};

export type DuplicateCandidate = {
  locationId: string;
  reason:
    | "same_address"
    | "nearby"
    | "similar_name"
    | "constructed"
    | "inspection_scheduled"
    | "do_not_visit";
  score: number;
  message: string;
};

export interface VisitPlanRepository {
  list(params: { userId?: string; date?: string }): Promise<VisitPlanWithItems[]>;
  get(planId: string): Promise<VisitPlanWithItems | null>;
  create(input: VisitPlanInput): Promise<VisitPlanWithItems>;
  addItem(planId: string, input: VisitPlanItemInput): Promise<VisitPlanWithItems>;
  removeItem(planId: string, planItemId: string): Promise<VisitPlanWithItems>;
  reorderItems(
    planId: string,
    orderedPlanItemIds: string[],
  ): Promise<VisitPlanWithItems>;
  updateStatus(
    planId: string,
    status: VisitPlan["status"],
  ): Promise<VisitPlanWithItems>;
}

export interface StorageService {
  saveNoteImage(params: {
    noteId: string;
    locationId: string;
    dataUrl: string;
    mimeType: "image/png" | "image/svg+xml";
  }): Promise<{ key: string; url: string }>;
  getPublicUrl(key: string): string;
}

export interface HandwrittenNoteRepository {
  listByLocation(locationId: string): Promise<HandwrittenNote[]>;
  get(noteId: string): Promise<HandwrittenNote | null>;
  create(input: HandwrittenNoteInput): Promise<HandwrittenNote>;
  softDelete(noteId: string, actorUserId: string): Promise<HandwrittenNote>;
}

export interface VisitRecordRepository {
  listByLocation(locationId: string): Promise<VisitRecord[]>;
  create(input: VisitRecordInput): Promise<VisitRecord>;
}

export type RoutePoint = {
  id: string;
  lat: number;
  lng: number;
  label: string;
};

export type OptimizedRoute = {
  orderedPointIds: string[];
  totalDistanceMeters?: number;
  totalDurationSeconds?: number;
  polyline?: string;
};

export interface RouteService {
  optimizeRoute(params: {
    start: RoutePoint;
    end?: RoutePoint;
    waypoints: RoutePoint[];
    travelMode: "car";
  }): Promise<OptimizedRoute>;
}

export interface GeocodingService {
  geocode(
    address: string,
  ): Promise<{ lat: number; lng: number; normalizedAddress?: string }>;
  reverseGeocode(params: {
    lat: number;
    lng: number;
    nearbyLocations?: Location[];
  }): Promise<{
    address: string;
    normalizedAddress?: string;
    confidence: "nearby_location" | "area" | "coordinate";
    sourceLocationId?: string;
  }>;
}

export interface MapTileProvider {
  getStyleUrl(): string;
}

export interface LocationRepository {
  list(): Promise<Location[]>;
  get(locationId: string): Promise<Location | null>;
  create(input: LocationInput, actorUserId: string): Promise<Location>;
  update(
    locationId: string,
    input: LocationInput,
    actorUserId: string,
  ): Promise<Location>;
  softDelete(locationId: string, actorUserId: string): Promise<Location>;
}

export type LocationInput = {
  customerName?: string;
  address: string;
  lat: number;
  lng: number;
  status: LocationStatus;
  assignedUserId?: string;
  areaId?: string;
  municipalityId?: string;
  constructionDate?: string;
  lastVisitDate?: string;
  nextInspectionDate?: string;
  memo?: string;
  tags?: string[];
};
