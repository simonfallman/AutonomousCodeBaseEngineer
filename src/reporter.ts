// src/reporter.ts
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { simpleGit } from "simple-git";
import type { AgentResult, AgentStep } from "./agent/loop.js";

const WRITE_TOOLS = new Set(["write_file", "apply_patch", "delete_file"]);

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[_]/g, " ")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function extractChangedFiles(steps: AgentStep[]): string[] {
  const files: string[] = [];
  for (const step of steps) {
    if (step.type === "tool_call" && step.tool && WRITE_TOOLS.has(step.tool)) {
      const raw = step.input?.path;
      const path = typeof raw === "string" && raw.length > 0 ? raw : undefined;
      if (path) files.push(path);
    }
  }
  return [...new Set(files)];
}

function extractFindings(steps: AgentStep[], answer: string): string[] {
  // Extract intermediate reasoning: text blocks that aren't the final answer
  const texts: string[] = [];
  for (const step of steps) {
    if (step.type === "tool_result" && step.tool === "run_tests" && step.output?.trim()) {
      texts.push(`Test results: ${step.output.trim().slice(0, 500)}`);
    }
  }
  // Fall back to answer summary if no intermediate findings
  if (texts.length === 0 && answer.trim()) texts.push(answer.trim());
  return texts;
}

export function buildReport(
  task: string,
  repoName: string,
  result: AgentResult,
  date: string,
  commitHash?: string
): string {
  const changedFiles = extractChangedFiles(result.steps);
  const findings = extractFindings(result.steps, result.answer);

  const lines: string[] = [
    `# ${task}`,
    `> ${repoName} | ${date}`,
    ``,
    `## Task`,
    task,
    ``,
    `## Key Findings`,
    findings.length > 0 ? findings.join("\n\n") : "_No findings recorded._",
    ``,
    `## Changes Made`,
  ];

  if (changedFiles.length > 0) {
    for (const f of changedFiles) {
      lines.push(`- \`${f}\``);
    }
  } else {
    lines.push("_No files modified._");
  }

  lines.push(``);
  lines.push(`## Result`);
  lines.push(result.answer);

  if (commitHash) {
    lines.push(``);
    lines.push(`**Commit:** \`${commitHash}\``);
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(`_Tokens: ${result.usage.inputTokens.toLocaleString()} in / ${result.usage.outputTokens.toLocaleString()} out_`);

  return lines.join("\n");
}

export async function writeReport(
  task: string,
  repoName: string,
  result: AgentResult,
  vaultPath: string,
  commitHash?: string
): Promise<string> {
  const date = new Date().toISOString().slice(0, 10);
  const repoSlug = repoName.replace(/\//g, "-");
  const taskSlug = slugify(task);
  const filename = `${date}-${repoSlug}-${taskSlug}.md`;

  const aceDir = join(vaultPath, "ACE");
  await mkdir(aceDir, { recursive: true });

  const filePath = join(aceDir, filename);
  const content = buildReport(task, repoName, result, date, commitHash);
  await writeFile(filePath, content, "utf-8");

  const git = simpleGit(vaultPath);
  await git.add(filePath);
  await git.commit(`ACE findings: ${repoName} — ${taskSlug}`);
  try {
    await git.push();
  } catch (err) {
    console.error(`[reporter] Failed to push vault: ${err instanceof Error ? err.message : err}`);
  }

  return filePath;
}
