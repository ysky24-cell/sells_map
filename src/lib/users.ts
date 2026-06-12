import type { User } from "@/types/domain";

export const mockUsers: User[] = [
  {
    userId: "admin-001",
    email: "admin@example.com",
    name: "管理者",
    role: "admin",
    active: true,
    assignedAreaIds: ["area-setagaya", "area-suginami", "area-chofu", "area-mitaka"],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    userId: "sales-001",
    email: "sato@example.com",
    name: "佐藤 担当",
    role: "sales",
    active: true,
    assignedAreaIds: ["area-setagaya", "area-chofu"],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    userId: "sales-002",
    email: "suzuki@example.com",
    name: "鈴木 担当",
    role: "sales",
    active: true,
    assignedAreaIds: ["area-setagaya", "area-mitaka"],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    userId: "sales-003",
    email: "tanaka@example.com",
    name: "田中 担当",
    role: "sales",
    active: true,
    assignedAreaIds: ["area-suginami", "area-setagaya"],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
];

export function findUser(userId?: string) {
  return mockUsers.find((user) => user.userId === userId);
}
