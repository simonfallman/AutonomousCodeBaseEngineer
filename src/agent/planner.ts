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

  try {
    return parsePlan(result.answer);
  } catch {
    return {
      summary: `Planner failed to produce a structured plan: ${result.answer.slice(0, 200)}`,
      items: [],
    };
  }
}
