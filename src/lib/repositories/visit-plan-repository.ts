import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type {
  VisitPlan,
  VisitPlanInput,
  VisitPlanItem,
  VisitPlanItemInput,
  VisitPlanRepository,
  VisitPlanWithItems,
} from "@/types/domain";

const PLANS_PATH = path.join(process.cwd(), "data", "visit-plans.json");
const ITEMS_PATH = path.join(process.cwd(), "data", "visit-plan-items.json");

async function readJsonFile<T>(filePath: string): Promise<T[]> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T[];
}

async function writeJsonFile<T>(filePath: string, records: T[]) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

async function readPlans() {
  return readJsonFile<VisitPlan>(PLANS_PATH);
}

async function readItems() {
  return readJsonFile<VisitPlanItem>(ITEMS_PATH);
}

function withItems(plan: VisitPlan, items: VisitPlanItem[]): VisitPlanWithItems {
  return {
    ...plan,
    items: items
      .filter((item) => item.planId === plan.planId)
      .sort((a, b) => a.order - b.order),
  };
}

export class JsonVisitPlanRepository implements VisitPlanRepository {
  async list(params: { userId?: string; date?: string }) {
    const [plans, items] = await Promise.all([readPlans(), readItems()]);
    return plans
      .filter((plan) => !params.userId || plan.userId === params.userId)
      .filter((plan) => !params.date || plan.date === params.date)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((plan) => withItems(plan, items));
  }

  async get(planId: string) {
    const [plans, items] = await Promise.all([readPlans(), readItems()]);
    const plan = plans.find((item) => item.planId === planId);
    return plan ? withItems(plan, items) : null;
  }

  async create(input: VisitPlanInput) {
    const plans = await readPlans();
    const existing = plans.find(
      (plan) => plan.userId === input.userId && plan.date === input.date,
    );
    if (existing) {
      const items = await readItems();
      return withItems(existing, items);
    }

    const now = new Date().toISOString();
    const plan: VisitPlan = {
      planId: `plan-${randomUUID()}`,
      userId: input.userId,
      date: input.date,
      status: "draft",
      memo: input.memo?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };

    plans.push(plan);
    await writeJsonFile(PLANS_PATH, plans);
    return { ...plan, items: [] };
  }

  async addItem(planId: string, input: VisitPlanItemInput) {
    const [plans, items] = await Promise.all([readPlans(), readItems()]);
    const planIndex = plans.findIndex((plan) => plan.planId === planId);
    if (planIndex === -1) throw new Error("Plan not found");

    const existing = items.find(
      (item) => item.planId === planId && item.locationId === input.locationId,
    );
    if (!existing) {
      const now = new Date().toISOString();
      const nextOrder =
        Math.max(
          0,
          ...items
            .filter((item) => item.planId === planId)
            .map((item) => item.order),
        ) + 1;

      items.push({
        planItemId: `plan-item-${randomUUID()}`,
        planId,
        locationId: input.locationId,
        order: nextOrder,
        priority: input.priority ?? "medium",
        preferredTimeWindow: input.preferredTimeWindow,
        memo: input.memo?.trim() || undefined,
        createdAt: now,
        updatedAt: now,
      });
    }

    plans[planIndex] = { ...plans[planIndex], updatedAt: new Date().toISOString() };
    await Promise.all([
      writeJsonFile(PLANS_PATH, plans),
      writeJsonFile(ITEMS_PATH, items),
    ]);

    return withItems(plans[planIndex], items);
  }

  async removeItem(planId: string, planItemId: string) {
    const [plans, items] = await Promise.all([readPlans(), readItems()]);
    const planIndex = plans.findIndex((plan) => plan.planId === planId);
    if (planIndex === -1) throw new Error("Plan not found");

    const remaining = items
      .filter((item) => !(item.planId === planId && item.planItemId === planItemId))
      .map((item) => ({ ...item }));
    const planItems = remaining
      .filter((item) => item.planId === planId)
      .sort((a, b) => a.order - b.order);
    planItems.forEach((item, index) => {
      item.order = index + 1;
      item.updatedAt = new Date().toISOString();
    });

    plans[planIndex] = { ...plans[planIndex], updatedAt: new Date().toISOString() };
    await Promise.all([
      writeJsonFile(PLANS_PATH, plans),
      writeJsonFile(ITEMS_PATH, remaining),
    ]);

    return withItems(plans[planIndex], remaining);
  }

  async reorderItems(planId: string, orderedPlanItemIds: string[]) {
    const [plans, items] = await Promise.all([readPlans(), readItems()]);
    const planIndex = plans.findIndex((plan) => plan.planId === planId);
    if (planIndex === -1) throw new Error("Plan not found");

    const now = new Date().toISOString();
    const orderMap = new Map(
      orderedPlanItemIds.map((planItemId, index) => [planItemId, index + 1]),
    );
    const reordered = items.map((item) =>
      item.planId === planId && orderMap.has(item.planItemId)
        ? { ...item, order: orderMap.get(item.planItemId) ?? item.order, updatedAt: now }
        : item,
    );

    plans[planIndex] = { ...plans[planIndex], updatedAt: now };
    await Promise.all([
      writeJsonFile(PLANS_PATH, plans),
      writeJsonFile(ITEMS_PATH, reordered),
    ]);

    return withItems(plans[planIndex], reordered);
  }

  async updateStatus(planId: string, status: VisitPlan["status"]) {
    const [plans, items] = await Promise.all([readPlans(), readItems()]);
    const planIndex = plans.findIndex((plan) => plan.planId === planId);
    if (planIndex === -1) throw new Error("Plan not found");

    plans[planIndex] = {
      ...plans[planIndex],
      status,
      updatedAt: new Date().toISOString(),
    };
    await writeJsonFile(PLANS_PATH, plans);

    return withItems(plans[planIndex], items);
  }
}

export const visitPlanRepository = new JsonVisitPlanRepository();
