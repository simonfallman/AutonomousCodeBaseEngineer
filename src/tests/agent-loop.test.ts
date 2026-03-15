import { describe, it, expect } from "vitest";
import { runAgentLoop } from "../agent/loop.js";

// These tests make real Bedrock API calls.
// Requires AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION to be set.
// Set REPO_PATH to a valid repo (the project itself works).

describe("runAgentLoop (real API)", () => {
  it("completes a simple task and returns reason 'complete'", async () => {
    const result = await runAgentLoop(
      "What is 2 + 2? Answer with just the number, no tool calls needed.",
      3,
    );

    expect(result.reason).toBe("complete");
    expect(result.answer).toBeTruthy();
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.steps[result.steps.length - 1].type).toBe("final_answer");
  }, 30_000);

  it("hits max_iterations when task requires many tool calls", async () => {
    const result = await runAgentLoop(
      "List all files in the repo root directory, then read each file one by one. Do not stop until you have read every single file.",
      2,
    );

    expect(result.reason).toBe("max_iterations");
    expect(result.answer).toContain("maximum 2 iterations");
    expect(result.steps.some((s) => s.type === "tool_call")).toBe(true);
  }, 60_000);

  it("aborts when signal is triggered", async () => {
    const controller = new AbortController();

    // Abort immediately so the loop catches it on first iteration check
    controller.abort();

    const result = await runAgentLoop(
      "List all files in the repo.",
      10,
      undefined,
      controller.signal,
    );

    expect(result.reason).toBe("aborted");
    expect(result.answer).toContain("aborted");
  }, 10_000);

  it("aborts mid-loop when signal fires during execution", async () => {
    const controller = new AbortController();

    // Abort after first progress callback (which fires after the first LLM call)
    let callCount = 0;
    const result = await runAgentLoop(
      "List all files in the repo root, then read each one.",
      10,
      () => {
        callCount++;
        // Abort after the first "Tools complete" callback
        if (callCount >= 3) controller.abort();
      },
      controller.signal,
    );

    expect(result.reason).toBe("aborted");
  }, 60_000);

  it("reports progress callbacks", async () => {
    const progress: string[] = [];
    await runAgentLoop(
      "What is 2 + 2? Just answer directly.",
      3,
      (msg) => progress.push(msg),
    );

    expect(progress.length).toBeGreaterThan(0);
    expect(progress.some((m) => m.includes("Thinking"))).toBe(true);
    expect(progress[progress.length - 1]).toBe("Done.");
  }, 30_000);
});
