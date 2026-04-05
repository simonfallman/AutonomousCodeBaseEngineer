// src/tests/reporter.test.ts
import { describe, it, expect } from "vitest";
import { slugify, buildReport } from "../reporter.js";
import type { AgentResult } from "../agent/loop.js";

describe("slugify", () => {
  it("lowercases and hyphenates words", () => {
    expect(slugify("Fix the streak bug")).toBe("fix-the-streak-bug");
  });

  it("strips special characters", () => {
    expect(slugify("Add parse_concepts() function")).toBe("add-parse-concepts-function");
  });

  it("truncates to 40 chars", () => {
    expect(slugify("A very long task description that exceeds the limit")).toBe(
      "a-very-long-task-description-that-exceed"
    );
  });

  it("converts underscores to hyphens", () => {
    expect(slugify("foo_bar")).toBe("foo-bar");
  });
});

describe("buildReport", () => {
  it("includes task and repo name in header", () => {
    const result: AgentResult = {
      steps: [],
      answer: "Done.",
      usage: { inputTokens: 100, outputTokens: 50 },
      reason: "complete",
    };
    const report = buildReport("Fix the bug", "simonfallman/trending", result, "2026-04-05");
    expect(report).toContain("# fix-the-bug");
    expect(report).toContain("simonfallman/trending");
    expect(report).toContain("2026-04-05");
  });

  it("includes the final answer under Result", () => {
    const result: AgentResult = {
      steps: [{ type: "final_answer", text: "Fixed the dedup logic in trending.py." }],
      answer: "Fixed the dedup logic in trending.py.",
      usage: { inputTokens: 200, outputTokens: 100 },
      reason: "complete",
    };
    const report = buildReport("Fix dedup", "simonfallman/trending", result, "2026-04-05");
    expect(report).toContain("## Result");
    expect(report).toContain("Fixed the dedup logic in trending.py.");
  });

  it("lists files changed from write_file and apply_patch tool calls", () => {
    const result: AgentResult = {
      steps: [
        { type: "tool_call", tool: "write_file", input: { path: "trending.py", content: "..." } },
        { type: "tool_call", tool: "apply_patch", input: { path: "tests/test_trending.py", diff: "..." } },
        { type: "tool_call", tool: "read_file", input: { path: "README.md" } },
      ],
      answer: "Done.",
      usage: { inputTokens: 100, outputTokens: 50 },
      reason: "complete",
    };
    const report = buildReport("Fix dedup", "simonfallman/trending", result, "2026-04-05");
    expect(report).toContain("trending.py");
    expect(report).toContain("tests/test_trending.py");
    expect(report).not.toContain("README.md");
  });

  it("falls back to result.answer for key findings when no final_answer steps exist", () => {
    const result: AgentResult = {
      steps: [],
      answer: "Fallback answer text.",
      usage: { inputTokens: 10, outputTokens: 5 },
      reason: "complete",
    };
    const report = buildReport("Fix bug", "simonfallman/trending", result, "2026-04-05");
    expect(report).toContain("## Key Findings");
    expect(report).toContain("Fallback answer text.");
  });

  it("includes delete_file in changes made", () => {
    const result: AgentResult = {
      steps: [
        { type: "tool_call", tool: "delete_file", input: { path: "old_script.py" } },
      ],
      answer: "Done.",
      usage: { inputTokens: 10, outputTokens: 5 },
      reason: "complete",
    };
    const report = buildReport("Remove old script", "simonfallman/trending", result, "2026-04-05");
    expect(report).toContain("old_script.py");
  });

  it("extracts Claude reasoning from text blocks as key findings", () => {
    const result: AgentResult = {
      steps: [
        { type: "tool_call", tool: "read_file", input: { path: "trending.py" } },
        { type: "tool_result", tool: "read_file", output: "..." },
        { type: "final_answer", text: "The dedup function was missing the weekly period. Fixed." },
      ],
      answer: "The dedup function was missing the weekly period. Fixed.",
      usage: { inputTokens: 100, outputTokens: 50 },
      reason: "complete",
    };
    const report = buildReport("Fix dedup", "simonfallman/trending", result, "2026-04-05");
    expect(report).toContain("## Key Findings");
    expect(report).toContain("The dedup function was missing the weekly period. Fixed.");
  });
});
