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
  const success = result.answer.trimStart().toUpperCase().startsWith("DONE:");

  return {
    item,
    success,
    output: result.answer,
    filesChanged,
  };
}
