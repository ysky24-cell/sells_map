import type { LocationStatus } from "@/types/domain";

export const locationStatusOptions: Array<{
  value: LocationStatus;
  label: string;
  shortLabel: string;
  color: string;
  marker: string;
}> = [
  {
    value: "unvisited",
    label: "未訪問",
    shortLabel: "未",
    color: "bg-zinc-500",
    marker: "#71717a",
  },
  {
    value: "visited",
    label: "訪問済み",
    shortLabel: "済",
    color: "bg-sky-600",
    marker: "#0284c7",
  },
  {
    value: "absent",
    label: "不在",
    shortLabel: "不",
    color: "bg-amber-500",
    marker: "#f59e0b",
  },
  {
    value: "prospect",
    label: "見込みあり",
    shortLabel: "見",
    color: "bg-emerald-600",
    marker: "#059669",
  },
  {
    value: "contracted",
    label: "契約済み",
    shortLabel: "契",
    color: "bg-indigo-600",
    marker: "#4f46e5",
  },
  {
    value: "constructed",
    label: "施工済み",
    shortLabel: "施",
    color: "bg-teal-700",
    marker: "#0f766e",
  },
  {
    value: "inspection_due",
    label: "点検予定",
    shortLabel: "点",
    color: "bg-violet-600",
    marker: "#7c3aed",
  },
  {
    value: "do_not_visit",
    label: "訪問NG",
    shortLabel: "NG",
    color: "bg-rose-700",
    marker: "#be123c",
  },
  {
    value: "lost",
    label: "失注",
    shortLabel: "失",
    color: "bg-slate-600",
    marker: "#475569",
  },
];

export function getStatusMeta(status: LocationStatus) {
  return (
    locationStatusOptions.find((option) => option.value === status) ??
    locationStatusOptions[0]
  );
}
