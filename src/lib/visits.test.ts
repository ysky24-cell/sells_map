import { describe, expect, it } from "vitest";
import {
  toDatetimeLocal,
  visitResultLabel,
  visitResultToStatus,
} from "@/lib/visits";

describe("visit helpers", () => {
  it("maps visit results to location statuses", () => {
    expect(visitResultToStatus("contracted")).toBe("contracted");
    expect(visitResultToStatus("revisit")).toBe("visited");
    expect(visitResultLabel("do_not_visit")).toBe("訪問NG");
  });

  it("formats datetime-local values without seconds", () => {
    expect(toDatetimeLocal(new Date("2026-06-13T09:30:45.000Z"))).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
    );
  });
});
