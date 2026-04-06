import { describe, it, expect } from "vitest";
import { parsePlan } from "../agent/planner.js";

describe("parsePlan", () => {
  it("parses a valid plan JSON string", () => {
    const input = JSON.stringify({
      summary: "Found two issues",
      items: [
        {
          id: "fix-1",
          file: "src/tools/git.ts",
          issue: "Protected branch check before sanitization",
          fix: "Move sanitizeBranchName before PROTECTED_BRANCHES check",
          verify: "run_build",
        },
      ],
    });

    const plan = parsePlan(input);

    expect(plan.summary).toBe("Found two issues");
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].id).toBe("fix-1");
    expect(plan.items[0].file).toBe("src/tools/git.ts");
    expect(plan.items[0].verify).toBe("run_build");
  });

  it("strips markdown JSON code fences before parsing", () => {
    const input = "```json\n" + JSON.stringify({ summary: "ok", items: [] }) + "\n```";
    const plan = parsePlan(input);
    expect(plan.items).toHaveLength(0);
  });

  it("strips plain code fences before parsing", () => {
    const input = "```\n" + JSON.stringify({ summary: "ok", items: [] }) + "\n```";
    const plan = parsePlan(input);
    expect(plan.summary).toBe("ok");
  });

  it("throws when items array is missing", () => {
    const input = JSON.stringify({ summary: "bad" });
    expect(() => parsePlan(input)).toThrow("Plan missing items array");
  });

  it("throws on invalid JSON", () => {
    expect(() => parsePlan("not json")).toThrow();
  });

  it("returns empty items array for a plan with no findings", () => {
    const input = JSON.stringify({ summary: "nothing found", items: [] });
    const plan = parsePlan(input);
    expect(plan.items).toHaveLength(0);
  });
});
