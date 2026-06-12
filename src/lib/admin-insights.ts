import type { Location, VisitRecord } from "@/types/domain";

export type AdminActionItem = {
  id: string;
  locationId: string;
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
};

export function buildAdminActionItems(
  locations: Location[],
  visitRecords: VisitRecord[],
  today: string,
): AdminActionItem[] {
  const visitedLocationIds = new Set(
    visitRecords.map((record) => record.locationId),
  );
  const items: AdminActionItem[] = [];

  locations.forEach((location) => {
    const label = location.customerName || location.address;

    if (!location.assignedUserId) {
      items.push({
        id: `${location.locationId}-unassigned`,
        locationId: location.locationId,
        severity: "high",
        title: "担当者未割当",
        description: `${label} に担当者が設定されていません。`,
      });
    }

    if (location.status === "do_not_visit") {
      items.push({
        id: `${location.locationId}-do-not-visit`,
        locationId: location.locationId,
        severity: "high",
        title: "訪問NG",
        description: `${label} は訪問NGです。予定追加前に管理者確認が必要です。`,
      });
    }

    if (
      location.nextInspectionDate &&
      location.nextInspectionDate < today &&
      location.status !== "constructed"
    ) {
      items.push({
        id: `${location.locationId}-overdue-inspection`,
        locationId: location.locationId,
        severity: "medium",
        title: "点検予定日超過",
        description: `${label} の次回点検日 ${location.nextInspectionDate} を過ぎています。`,
      });
    }

    if (!location.lastVisitDate && !visitedLocationIds.has(location.locationId)) {
      items.push({
        id: `${location.locationId}-no-visit-record`,
        locationId: location.locationId,
        severity: "low",
        title: "訪問履歴なし",
        description: `${label} は訪問履歴がまだありません。初回接触状況を確認してください。`,
      });
    }
  });

  const severityOrder = { high: 3, medium: 2, low: 1 };
  return items.sort(
    (a, b) =>
      severityOrder[b.severity] - severityOrder[a.severity] ||
      a.title.localeCompare(b.title, "ja"),
  );
}
