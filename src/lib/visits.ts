import type { LocationStatus, VisitRecord } from "@/types/domain";

export const visitResultOptions: Array<{
  value: VisitRecord["result"];
  label: string;
  status?: LocationStatus;
}> = [
  { value: "visited", label: "訪問済み", status: "visited" },
  { value: "absent", label: "不在", status: "absent" },
  { value: "revisit", label: "再訪問予定", status: "visited" },
  { value: "prospect", label: "見込みあり", status: "prospect" },
  { value: "contracted", label: "契約済み", status: "contracted" },
  { value: "lost", label: "失注", status: "lost" },
  { value: "do_not_visit", label: "訪問NG", status: "do_not_visit" },
];

export function toDatetimeLocal(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

export function datetimeLocalToIso(value: string) {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

export function formatVisitDateTime(value: string) {
  return new Date(value).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function toLocalDateString(value: string) {
  const date = new Date(value);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

export function visitResultLabel(result: VisitRecord["result"]) {
  return visitResultOptions.find((option) => option.value === result)?.label ?? result;
}

export function visitResultToStatus(result: VisitRecord["result"]) {
  return visitResultOptions.find((option) => option.value === result)?.status;
}
