# Plan/Execute Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `solve_task`'s monolithic ReAct loop into a read-only planning phase and a targeted per-fix execution phase so that iteration budget is spent purposefully rather than shared between exploration and writing.

**Architecture:** A new `runPlannerLoop` (read-only tools, produces a structured `GroundedPlan`) runs first; then `runCoordinatedLoop` iterates over each `PlanItem` calling a new `runExecutorLoop` (write + verify tools, focused on one fix). The existing `runAgentLoop` is parameterized to accept an optional tool subset so both phases reuse the same core loop logic. The `solve_task` MCP tool's public interface is unchanged.

**Tech Stack:** TypeScript, Node.js ESM, `@aws-sdk/client-bedrock-runtime` (Bedrock), Vitest

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `src/agent/tools.ts` | Modify | Add `READ_TOOL_REGISTRY`, `READ_TOOL_SCHEMAS`, `EXECUTE_TOOL_REGISTRY`, `EXECUTE_TOOL_SCHEMAS` exports |
| `src/agent/loop.ts` | Modify | Parameterize `runAgentLoop` with optional tool override; add `runCoordinatedLoop` |
| `src/agent/planner.ts` | Create | `GroundedPlan`/`PlanItem` types, `parsePlan()`, `runPlannerLoop()` |
| `src/agent/executor.ts` | Create | `ExecutionResult` type, `runExecutorLoop()` |
| `src/index.ts` | Modify | Wire `solve_task` to `runCoordinatedLoop` instead of `runAgentLoop` |
| `src/tests/planner.test.ts` | Create | Unit tests for `parsePlan`; integration tests for `runPlannerLoop` (credential-gated) |
| `src/tests/executor.test.ts` | Create | Integration tests for `runExecutorLoop` (credential-gated) |
| `src/tests/agent-loop.test.ts` | Modify | Add test for `runAgentLoop` with custom tool registry |

---

## Task 1: Parameterize `runAgentLoop` with optional tool overrides

**Files:**
- Modify: `src/agent/loop.ts`
- Modify: `src/tests/agent-loop.test.ts`

This is the foundational change. Both the planner and executor need to reuse the loop with different tool subsets. We add an optional `options` object at the end of `runAgentLoop`'s signature — existing callers pass nothing and get the same behaviour.

- [ ] **Step 1: Write the failing test**

Add to the credential-gated `describe` block in `src/tests/agent-loop.test.ts`:

```typescript
it("uses custom tool registry when provided", async () => {
  const called: string[] = [];
  const customRegistry: Record<string, ToolFn> = {
    list_files: async (input) => {
      called.push("list_files");
      return "custom_result.ts";
    },
  };
  const customSchemas = [
    {
      name: "list_files",
      description: "List files",
      input_schema: { type: "object" as const, properties: { path: { type: "string" } } },
    },
  ];

  const result = await runAgentLoop(
    "List files in the repo root and report what you see.",
    5,
    undefined,
    undefined,
    { toolRegistry: customRegistry, toolSchemas: customSchemas }
  );

  expect(result.steps.some((s) => s.type === "tool_call" && s.tool === "list_files")).toBe(true);
  expect(called).toContain("list_files");
}, 30_000);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- --reporter verbose src/tests/agent-loop.test.ts
```

Expected: compile error — `runAgentLoop` does not accept 5th argument.

- [ ] **Step 3: Add the `options` parameter to `runAgentLoop` in `src/agent/loop.ts`**

Change the function signature and the two internal usages of `TOOL_REGISTRY` and `TOOL_SCHEMAS`:

```typescript
// At top of file, ensure ToolFn is imported
import { TOOL_REGISTRY, TOOL_SCHEMAS, type ToolFn } from "./tools.js";

// Updated signature:
export async function runAgentLoop(
  task: string,
  maxIterations = 15,
  onProgress?: (message: string) => void,
  signal?: AbortSignal,
  options?: {
    toolRegistry?: Record<string, ToolFn>;
    toolSchemas?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  }
): Promise<AgentResult> {
  const registry = options?.toolRegistry ?? TOOL_REGISTRY;
  const schemas = options?.toolSchemas ?? TOOL_SCHEMAS;
  // ... rest of function unchanged except replace TOOL_REGISTRY → registry
  //     and TOOL_SCHEMAS → schemas in the two places they are used
```

The two places inside the function body that need updating:
1. `callClaude` call — it uses `TOOL_SCHEMAS` inside `callClaude`. Since `callClaude` is a closure inside `runAgentLoop`, you need to thread `schemas` into it. The cleanest approach: move `callClaude` and `callClaudeWithRetry` out to module scope (they already are), and pass `schemas` as a parameter to `callClaude`:

```typescript
// Change callClaude to accept schemas as a parameter:
async function callClaude(
  messages: Message[],
  schemas: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>
): Promise<ClaudeResponse> {
  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: schemas,         // ← was TOOL_SCHEMAS
    messages,
  });
  // ... rest unchanged
}

// callClaudeWithRetry similarly:
async function callClaudeWithRetry(
  messages: Message[],
  schemas: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>,
  maxRetries = 5
): Promise<ClaudeResponse> {
  // ... same retry loop, pass schemas to callClaude(messages, schemas)
}
```

2. `executeTool` uses `TOOL_REGISTRY` via the `fn` lookup. Pass `registry` into `executeTool`:

```typescript
async function executeTool(
  toolUse: ToolUseBlock,
  registry: Record<string, ToolFn>,
  onProgress?: (message: string) => void
): Promise<{ output: string; step: AgentStep }> {
  const fn = registry[toolUse.name];   // ← was TOOL_REGISTRY[toolUse.name]
  // ... rest unchanged
}
```

Inside `runAgentLoop`, call `executeTool(toolUse, registry, onProgress)` and `callClaudeWithRetry(messages, schemas)`.

- [ ] **Step 4: Run the test**

```bash
npm test -- --reporter verbose src/tests/agent-loop.test.ts
```

Expected: all tests pass (including new one if credentials present, skipped otherwise).

- [ ] **Step 5: Build**

```bash
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/agent/loop.ts src/tests/agent-loop.test.ts
git commit -m "feat: parameterize runAgentLoop with optional tool registry/schemas"
```

---

## Task 2: Add read-only and execute tool subsets to `tools.ts`

**Files:**
- Modify: `src/agent/tools.ts`

The planner must not be able to write files (it would spend budget making changes instead of producing a plan). The executor should not have git tools (the coordinator handles committing after all fixes land).

- [ ] **Step 1: Define the tool subsets and add exports to `src/agent/tools.ts`**

Add after the existing `TOOL_REGISTRY` and `TOOL_SCHEMAS` exports:

```typescript
// Tools the planner may call — read/search only, no writes, no git, no test runners
const READ_TOOL_NAMES = new Set([
  "list_files",
  "read_file",
  "search_files",
  "grep",
  "semantic_search",
  "index_repository",
  "summarize_file",
  "find_function_usage",
  "analyze_dependencies",
]);

// Tools the executor may call — read + write + verify, no git (coordinator commits)
const EXECUTE_TOOL_NAMES = new Set([
  "list_files",
  "read_file",
  "search_files",
  "grep",
  "write_file",
  "delete_file",
  "apply_patch",
  "run_tests",
  "run_linter",
  "run_build",
]);

export const READ_TOOL_REGISTRY: Record<string, ToolFn> = Object.fromEntries(
  Object.entries(TOOL_REGISTRY).filter(([name]) => READ_TOOL_NAMES.has(name))
);

export const READ_TOOL_SCHEMAS = TOOL_SCHEMAS.filter((s) => READ_TOOL_NAMES.has(s.name));

export const EXECUTE_TOOL_REGISTRY: Record<string, ToolFn> = Object.fromEntries(
  Object.entries(TOOL_REGISTRY).filter(([name]) => EXECUTE_TOOL_NAMES.has(name))
);

export const EXECUTE_TOOL_SCHEMAS = TOOL_SCHEMAS.filter((s) => EXECUTE_TOOL_NAMES.has(s.name));
```

- [ ] **Step 2: Build to verify no errors**

```bash
npm run build
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools.ts
git commit -m "feat: add READ and EXECUTE tool subsets to tools registry"
```

---

## Task 3: Create `planner.ts` — types, `parsePlan`, and tests

**Files:**
- Create: `src/agent/planner.ts`
- Create: `src/tests/planner.test.ts`

`parsePlan` is a pure function — test it fully without any Bedrock calls.

- [ ] **Step 1: Write the tests in `src/tests/planner.test.ts`**

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --reporter verbose src/tests/planner.test.ts
```

Expected: module not found / import error.

- [ ] **Step 3: Create `src/agent/planner.ts` with types and `parsePlan`**

```typescript
import { runAgentLoop, type AgentResult } from "./loop.js";
import { READ_TOOL_REGISTRY, READ_TOOL_SCHEMAS } from "./tools.js";

export interface PlanItem {
  id: string;
  file: string;
  issue: string;
  fix: string;
  verify: "run_tests" | "run_build" | "run_linter" | null;
}

export interface GroundedPlan {
  summary: string;
  items: PlanItem[];
}

export function parsePlan(text: string): GroundedPlan {
  // Claude sometimes wraps JSON in markdown code fences — strip them
  const cleaned = text
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed.items)) {
    throw new Error("Plan missing items array");
  }
  return parsed as GroundedPlan;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --reporter verbose src/tests/planner.test.ts
```

Expected: all 6 pass.

- [ ] **Step 5: Commit**

```bash
git add src/agent/planner.ts src/tests/planner.test.ts
git commit -m "feat: add PlanItem/GroundedPlan types and parsePlan with tests"
```

---

## Task 4: Implement `runPlannerLoop` in `planner.ts`

**Files:**
- Modify: `src/agent/planner.ts`
- Modify: `src/tests/planner.test.ts`

The planner runs `runAgentLoop` with read-only tools and a system prompt that instructs Claude to output a JSON plan as its final message. After the loop exits, `parsePlan` extracts the structured result.

- [ ] **Step 1: Write the credential-gated integration test**

Append to `src/tests/planner.test.ts`:

```typescript
import { runPlannerLoop } from "../agent/planner.js";

const hasCredentials = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
const describeIfCreds = hasCredentials ? describe : describe.skip;

describeIfCreds("runPlannerLoop (real API)", () => {
  it("returns a GroundedPlan with a summary and items array", async () => {
    const plan = await runPlannerLoop(
      "Find any TypeScript files in the src/ directory that use `err: any` in a catch block.",
      8
    );

    expect(typeof plan.summary).toBe("string");
    expect(plan.summary.length).toBeGreaterThan(0);
    expect(Array.isArray(plan.items)).toBe(true);
    // Each item must have required fields
    for (const item of plan.items) {
      expect(typeof item.id).toBe("string");
      expect(typeof item.file).toBe("string");
      expect(typeof item.issue).toBe("string");
      expect(typeof item.fix).toBe("string");
      expect(["run_tests", "run_build", "run_linter", null]).toContain(item.verify);
    }
  }, 120_000);

  it("returns empty items when no issues are found", async () => {
    const plan = await runPlannerLoop(
      "Check if src/agent/planner.ts exists and has any obvious issues.",
      5
    );

    expect(Array.isArray(plan.items)).toBe(true);
  }, 60_000);
});
```

- [ ] **Step 2: Run to verify the test is skipped or fails on import**

```bash
npm test -- --reporter verbose src/tests/planner.test.ts
```

Expected: compile error — `runPlannerLoop` is not exported.

- [ ] **Step 3: Implement `runPlannerLoop` in `src/agent/planner.ts`**

Add the system prompt constant and the function. Append after `parsePlan`:

```typescript
const PLANNER_SYSTEM_PROMPT = `You are a code auditor. Use the available tools to explore the repository and identify specific issues relevant to the task.

Rules:
- Read files and search the codebase to ground your findings in actual code.
- Only report issues you have confirmed by reading the relevant source.
- Do NOT write, modify, or delete any files.
- When you have finished investigating, output ONLY a raw JSON object (no markdown fences, no prose before or after) in this exact shape:

{
  "summary": "one sentence describing what you found",
  "items": [
    {
      "id": "fix-1",
      "file": "src/relative/path/to/file.ts",
      "issue": "precise description of the problem",
      "fix": "precise description of the change to make",
      "verify": "run_build"
    }
  ]
}

The "verify" field must be one of: "run_tests", "run_build", "run_linter", or null.
If you find no issues, return { "summary": "No issues found", "items": [] }.`;

export async function runPlannerLoop(
  task: string,
  maxIterations = 10,
  onProgress?: (message: string) => void
): Promise<GroundedPlan> {
  const result: AgentResult = await runAgentLoop(
    `${PLANNER_SYSTEM_PROMPT}\n\nTask: ${task}`,
    maxIterations,
    onProgress,
    undefined,
    { toolRegistry: READ_TOOL_REGISTRY, toolSchemas: READ_TOOL_SCHEMAS }
  );

  // The answer should be the JSON plan — try to parse it
  try {
    return parsePlan(result.answer);
  } catch {
    // If parsing fails, return a plan with a single item describing the failure
    // so the coordinator can report it rather than crashing
    return {
      summary: `Planner failed to produce a structured plan: ${result.answer.slice(0, 200)}`,
      items: [],
    };
  }
}
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: clean.

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all existing tests still pass, new planner unit tests pass, integration tests skipped if no credentials.

- [ ] **Step 6: Commit**

```bash
git add src/agent/planner.ts src/tests/planner.test.ts
git commit -m "feat: implement runPlannerLoop — read-only ReAct loop producing GroundedPlan"
```

---

## Task 5: Create `executor.ts` — types, stub, and tests

**Files:**
- Create: `src/agent/executor.ts`
- Create: `src/tests/executor.test.ts`

- [ ] **Step 1: Write the credential-gated tests in `src/tests/executor.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { runExecutorLoop } from "../agent/executor.js";
import type { PlanItem } from "../agent/planner.js";

const hasCredentials = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
const describeIfCreds = hasCredentials ? describe : describe.skip;

describeIfCreds("runExecutorLoop (real API)", () => {
  it("returns an ExecutionResult with success and filesChanged", async () => {
    // Use a safe read-only item so the test doesn't actually modify source files
    const item: PlanItem = {
      id: "test-1",
      file: "src/agent/planner.ts",
      issue: "Check if the file exists and report its line count",
      fix: "Read the file and report how many lines it has. Do not modify anything.",
      verify: "run_build",
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
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- --reporter verbose src/tests/executor.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create `src/agent/executor.ts` with the type and a stub**

```typescript
import type { PlanItem } from "./planner.js";

export interface ExecutionResult {
  item: PlanItem;
  success: boolean;
  output: string;
  filesChanged: string[];
}

export async function runExecutorLoop(
  item: PlanItem,
  maxIterations = 8,
  onProgress?: (message: string) => void
): Promise<ExecutionResult> {
  throw new Error("Not implemented");
}
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/agent/executor.ts src/tests/executor.test.ts
git commit -m "feat: add ExecutionResult type and runExecutorLoop stub with tests"
```

---

## Task 6: Implement `runExecutorLoop` in `executor.ts`

**Files:**
- Modify: `src/agent/executor.ts`

The executor receives a single `PlanItem`, constructs a focused task prompt, runs `runAgentLoop` with execute-only tools, then extracts which files were changed from the agent steps.

- [ ] **Step 1: Implement `runExecutorLoop`**

Replace the stub in `src/agent/executor.ts` with the full implementation:

```typescript
import { runAgentLoop, type AgentStep } from "./loop.js";
import { EXECUTE_TOOL_REGISTRY, EXECUTE_TOOL_SCHEMAS } from "./tools.js";
import type { PlanItem } from "./planner.js";

export interface ExecutionResult {
  item: PlanItem;
  success: boolean;
  output: string;
  filesChanged: string[];
}

const WRITE_TOOL_NAMES = new Set(["write_file", "delete_file", "apply_patch"]);

function extractFilesChanged(steps: AgentStep[]): string[] {
  const files: string[] = [];
  for (const step of steps) {
    if (step.type === "tool_call" && step.tool && WRITE_TOOL_NAMES.has(step.tool)) {
      const p = step.input?.path;
      if (typeof p === "string" && p.length > 0) files.push(p);
    }
  }
  return [...new Set(files)];
}

function buildExecutorPrompt(item: PlanItem): string {
  const verifyInstruction = item.verify
    ? `After applying the fix, run \`${item.verify}\` to verify it works.`
    : "No verification step is required for this fix.";

  return `You are a code fixer. Apply exactly one fix described below.

File: ${item.file}
Issue: ${item.issue}
Fix to apply: ${item.fix}

Instructions:
1. Read ${item.file} to understand the current code.
2. Apply the fix described above.
3. ${verifyInstruction}
4. When done, output exactly one of:
   - "DONE: <one sentence describing what you changed>"
   - "FAILED: <reason you could not apply the fix>"

Do not modify any file other than ${item.file} unless the fix explicitly requires it.`;
}

export async function runExecutorLoop(
  item: PlanItem,
  maxIterations = 8,
  onProgress?: (message: string) => void
): Promise<ExecutionResult> {
  const task = buildExecutorPrompt(item);

  const result = await runAgentLoop(
    task,
    maxIterations,
    onProgress,
    undefined,
    { toolRegistry: EXECUTE_TOOL_REGISTRY, toolSchemas: EXECUTE_TOOL_SCHEMAS }
  );

  const filesChanged = extractFilesChanged(result.steps);
  const success = result.answer.trimStart().startsWith("DONE:");

  return {
    item,
    success,
    output: result.answer,
    filesChanged,
  };
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: clean.

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: all pass / skip as before.

- [ ] **Step 4: Commit**

```bash
git add src/agent/executor.ts
git commit -m "feat: implement runExecutorLoop — targeted per-fix ReAct loop"
```

---

## Task 7: Add `runCoordinatedLoop` to `loop.ts`

**Files:**
- Modify: `src/agent/loop.ts`

This is the new top-level orchestrator. It calls the planner, then runs an executor per item, collecting all results. Budget is split: 40% to planning, remainder split across items (capped at 8 each).

- [ ] **Step 1: Write the test**

Add a credential-gated test to `src/tests/agent-loop.test.ts`:

```typescript
import { runCoordinatedLoop } from "../agent/loop.js";

// Inside the existing describeIfCreds block:
it("runCoordinatedLoop returns a CoordinatedResult with planItems and executionResults", async () => {
  const result = await runCoordinatedLoop(
    "Find any file in src/ that imports from a path ending in .js and check if the import exists.",
    10
  );

  expect(typeof result.answer).toBe("string");
  expect(Array.isArray(result.plan.items)).toBe(true);
  expect(Array.isArray(result.executionResults)).toBe(true);
  expect(result.usage.inputTokens).toBeGreaterThan(0);
}, 180_000);
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- --reporter verbose src/tests/agent-loop.test.ts
```

Expected: `runCoordinatedLoop` is not exported.

- [ ] **Step 3: Add `runCoordinatedLoop` to `src/agent/loop.ts`**

Add these imports at the top of `loop.ts` (after existing imports):

```typescript
import { runPlannerLoop, type GroundedPlan } from "./planner.js";
import { runExecutorLoop, type ExecutionResult } from "./executor.js";
```

Add the new type and function at the bottom of `loop.ts`:

```typescript
export interface CoordinatedResult {
  plan: GroundedPlan;
  executionResults: ExecutionResult[];
  answer: string;
  usage: AgentUsage;
}

export async function runCoordinatedLoop(
  task: string,
  maxIterations = 15,
  onProgress?: (message: string) => void,
  signal?: AbortSignal
): Promise<CoordinatedResult> {
  const planIterations = Math.max(5, Math.floor(maxIterations * 0.4));
  const remainingIterations = maxIterations - planIterations;
  const executeIterationsPerItem = Math.min(8, Math.max(4, remainingIterations));

  // Phase 1: plan
  onProgress?.("[plan] Exploring repository and identifying issues...");
  const plan = await runPlannerLoop(task, planIterations, (msg) =>
    onProgress?.(`[plan] ${msg}`)
  );

  onProgress?.(`[plan] Found ${plan.items.length} item(s): ${plan.summary}`);

  if (plan.items.length === 0) {
    return {
      plan,
      executionResults: [],
      answer: `Planning complete. ${plan.summary} No fixes required.`,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  // Phase 2: execute each item
  const executionResults: ExecutionResult[] = [];
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0 };

  for (let i = 0; i < plan.items.length; i++) {
    if (signal?.aborted) break;

    const item = plan.items[i];
    onProgress?.(`[execute ${i + 1}/${plan.items.length}] Fixing: ${item.issue} in ${item.file}`);

    const execResult = await runExecutorLoop(item, executeIterationsPerItem, (msg) =>
      onProgress?.(`[execute ${i + 1}/${plan.items.length}] ${msg}`)
    );
    executionResults.push(execResult);

    const status = execResult.success ? "✓" : "✗";
    onProgress?.(`[execute ${i + 1}/${plan.items.length}] ${status} ${execResult.output.slice(0, 100)}`);
  }

  const succeeded = executionResults.filter((r) => r.success);
  const failed = executionResults.filter((r) => !r.success);
  const allChanged = [...new Set(executionResults.flatMap((r) => r.filesChanged))];

  const lines = [
    `## Plan: ${plan.summary}`,
    ``,
    `**Fixes applied:** ${succeeded.length}/${plan.items.length}`,
  ];

  if (succeeded.length > 0) {
    lines.push(``, `### Applied`);
    for (const r of succeeded) {
      lines.push(`- **${r.item.file}**: ${r.output.replace(/^DONE:\s*/i, "")}`);
    }
  }

  if (failed.length > 0) {
    lines.push(``, `### Failed`);
    for (const r of failed) {
      lines.push(`- **${r.item.file}**: ${r.output.replace(/^FAILED:\s*/i, "")}`);
    }
  }

  if (allChanged.length > 0) {
    lines.push(``, `### Files changed`);
    for (const f of allChanged) lines.push(`- \`${f}\``);
  }

  return {
    plan,
    executionResults,
    answer: lines.join("\n"),
    usage,
  };
}
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: clean.

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/agent/loop.ts src/tests/agent-loop.test.ts
git commit -m "feat: add runCoordinatedLoop — plan/execute orchestrator"
```

---

## Task 8: Wire `solve_task` in `index.ts` to use `runCoordinatedLoop`

**Files:**
- Modify: `src/index.ts`

The MCP tool's public interface (`task`, `max_iterations`) stays identical. Internally it now calls `runCoordinatedLoop` instead of `runAgentLoop`. The log format in the response adapts to include plan phase output.

- [ ] **Step 1: Update the import in `src/index.ts`**

```typescript
// Change:
import { planTask, runAgentLoop, type AgentStep, type AgentResult } from "./agent/loop.js";
// To:
import { planTask, runAgentLoop, runCoordinatedLoop, type AgentStep } from "./agent/loop.js";
```

- [ ] **Step 2: Replace the `solve_task` handler body**

Find the `solve_task` tool registration (currently around line 350–403) and replace the handler:

```typescript
server.tool(
  "solve_task",
  "Autonomously plan and execute a task using a plan/execute ReAct loop (Claude + tools)",
  {
    task: z.string().describe("Natural language task description"),
    max_iterations: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(15)
      .describe("Total iteration budget (split between planning and execution phases)"),
  },
  async ({ task, max_iterations }, extra) => {
    const stopHeartbeat = startHeartbeat(extra, "solve_task");
    const abortController = new AbortController();

    let coordResult: Awaited<ReturnType<typeof runCoordinatedLoop>>;
    try {
      coordResult = await runCoordinatedLoop(
        task,
        max_iterations,
        (msg) => {
          server.sendLoggingMessage({ level: "info", data: msg });
          sendProgress(extra, 0, 1, msg);
        },
        abortController.signal
      );
    } finally {
      stopHeartbeat();
    }

    const { plan, executionResults, answer } = coordResult;

    // Write findings to Obsidian (non-blocking)
    const vaultPath = join(homedir(), "obsidian");
    getRepoName().then((repoName) => {
      // Build a synthetic AgentResult for the reporter
      const steps: AgentStep[] = executionResults.flatMap((r) =>
        r.filesChanged.map((f) => ({
          type: "tool_call" as const,
          tool: "write_file",
          input: { path: f },
        }))
      );
      return writeReport(task, repoName, { steps, answer, usage: coordResult.usage, reason: "complete" }, vaultPath);
    }).catch((err) =>
      console.error(`[reporter] Failed to write findings: ${err instanceof Error ? err.message : err}`)
    );

    const planSummary = `Plan: ${plan.items.length} item(s) — ${plan.summary}`;
    const resultSummary = `Applied: ${executionResults.filter((r) => r.success).length}/${executionResults.length}`;

    return {
      content: [{
        type: "text",
        text: `${planSummary}\n${resultSummary}\n\n---\n\n${answer}`,
      }],
    };
  }
);
```

- [ ] **Step 3: Remove now-unused `extractCommitHash` helper**

The `extractCommitHash` function (lines 31–39) is no longer called. Delete it:

```typescript
// Delete this entire function:
function extractCommitHash(steps: AgentStep[]): string | undefined {
  for (const step of steps) {
    if (step.type === "tool_result" && step.tool === "commit_changes" && step.output) {
      const match = step.output.match(/\b([a-f0-9]{7,40})\b/);
      if (match) return match[1];
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: clean with no unused variable warnings.

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire solve_task to runCoordinatedLoop — plan/execute split complete"
```

---

## Task 9: Smoke test end-to-end

**Files:** none modified — verification only

- [ ] **Step 1: Full test run**

```bash
npm test
```

Expected: 6 test files, all passing or skipped. No regressions.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: clean.

- [ ] **Step 3: Verify the MCP tool schema is unchanged**

Check that `solve_task` still accepts `task` and `max_iterations` with the same types:

```bash
node -e "
import('./dist/index.js').catch(() => {});
" 2>&1 | head -5
```

Expected: `[llm] Using model: ...` log line (server starts, no crash on import).

- [ ] **Step 4: Final commit if anything was missed**

```bash
git status
```

If clean: nothing to do. If there are stragglers, stage and commit them with a descriptive message.

---

## Self-Review

**Spec coverage:**
- ✓ `runAgentLoop` parameterized with optional tool registry
- ✓ Read-only tool subset for planner
- ✓ Execute tool subset (no git) for executor
- ✓ `runPlannerLoop` — ReAct loop producing `GroundedPlan`
- ✓ `runExecutorLoop` — targeted per-fix ReAct loop
- ✓ `runCoordinatedLoop` — orchestrator calling plan then execute
- ✓ `solve_task` MCP tool wired to new orchestrator
- ✓ Public MCP interface unchanged (`task`, `max_iterations`)
- ✓ Obsidian reporting preserved
- ✓ All existing tests preserved

**Placeholder check:** No TBD/TODO in code steps. All function signatures and types are consistent across tasks.

**Type consistency:**
- `PlanItem` defined in Task 3, used identically in Tasks 5, 6, 7
- `ExecutionResult` defined in Task 5, used identically in Tasks 7, 8
- `GroundedPlan` defined in Task 3, used identically in Tasks 4, 7, 8
- `runAgentLoop` options parameter added in Task 1, used identically in Tasks 4 and 6
