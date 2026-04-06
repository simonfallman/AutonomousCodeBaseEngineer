import { describe, it, expect } from "vitest";
import { runExecutorLoop } from "../agent/executor.js";
import type { PlanItem } from "../agent/planner.js";

const hasCredentials = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
const describeIfCreds = hasCredentials ? describe : describe.skip;

describeIfCreds("runExecutorLoop (real API)", () => {
  it("returns an ExecutionResult with success and filesChanged", async () => {
    // Use a safe read-only item so the test doesn't modify source files
    const item: PlanItem = {
      id: "test-1",
      file: "src/agent/planner.ts",
      issue: "Check if the file exists and report its line count",
      fix: "Read the file and report how many lines it has. Do not modify anything.",
      verify: null,
    };

    const result = await runExecutorLoop(item, 6);

    expect(result.item).toBe(item);
    expect(typeof result.success).toBe("boolean");
    expect(typeof result.output).toBe("string");
    expect(Array.isArray(result.filesChanged)).toBe(true);
  }, 60_000);

  it("reports failure gracefully when fix cannot be applied", async () => {
    const item: PlanItem = {
      id: "test-bad",
      file: "src/does-not-exist.ts",
      issue: "This file does not exist",
      fix: "Fix a non-existent file",
      verify: null,
    };

    const result = await runExecutorLoop(item, 4);

    expect(typeof result.success).toBe("boolean");
    expect(typeof result.output).toBe("string");
  }, 30_000);
});
