# ACE Obsidian Findings Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After every `solve_task` run, automatically write a findings report to `~/obsidian/ACE/YYYY-MM-DD-<repo>-<task-slug>.md` and commit+push it to the Obsidian vault git repo.

**Architecture:** A new `src/reporter.ts` module handles report building and vault commit. `solve_task` in `src/index.ts` calls `writeReport()` after `runAgentLoop()` completes. The report extracts "why" reasoning from Claude's text blocks in the agent steps, lists files changed (from `write_file`/`apply_patch`/`delete_file` tool calls), and includes the final answer and commit hash if one was made.

**Tech Stack:** TypeScript, Node.js `fs/promises`, `simple-git`, existing `AgentResult`/`AgentStep` types from `src/agent/loop.ts`.

---

## File Structure

| File | Change |
|------|--------|
| `src/reporter.ts` | New — `buildReport()`, `writeReport()`, `slugify()` |
| `src/index.ts` | Modify `solve_task` handler to call `writeReport()` after agent loop |
| `src/tests/reporter.test.ts` | New — tests for `buildReport()` and `slugify()` |

---

### Task 1: Implement `slugify()` and `buildReport()` (TDD)

**Files:**
- Create: `src/reporter.ts`
- Create: `src/tests/reporter.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
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
    expect(report).not.toContain("README.md"); // read_file should not appear
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
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd ~/AutonomousCodeBaseEngineer && npm test -- src/tests/reporter.test.ts 2>&1 | tail -15
```

Expected: FAIL — `Cannot find module '../reporter.js'`

- [ ] **Step 3: Create `src/reporter.ts` with `slugify()` and `buildReport()`**

```typescript
// src/reporter.ts
import { AgentResult, AgentStep } from "./agent/loop.js";

const WRITE_TOOLS = new Set(["write_file", "apply_patch", "delete_file"]);

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
}

function extractChangedFiles(steps: AgentStep[]): string[] {
  const files: string[] = [];
  for (const step of steps) {
    if (step.type === "tool_call" && step.tool && WRITE_TOOLS.has(step.tool)) {
      const path = step.input?.path as string | undefined;
      if (path) files.push(path);
    }
  }
  return [...new Set(files)];
}

function extractFindings(steps: AgentStep[], answer: string): string[] {
  const texts: string[] = [];
  for (const step of steps) {
    if (step.type === "final_answer" && step.text?.trim()) {
      texts.push(step.text.trim());
    }
  }
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
  const slug = slugify(task);
  const changedFiles = extractChangedFiles(result.steps);
  const findings = extractFindings(result.steps, result.answer);

  const lines: string[] = [
    `# ${slug}`,
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
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd ~/AutonomousCodeBaseEngineer && npm test -- src/tests/reporter.test.ts 2>&1 | tail -15
```

Expected: all `buildReport` and `slugify` tests PASS

- [ ] **Step 5: Commit**

```bash
cd ~/AutonomousCodeBaseEngineer && git add src/reporter.ts src/tests/reporter.test.ts && git commit -m "Add buildReport() and slugify() for Obsidian findings reports"
```

---

### Task 2: Implement `writeReport()` (TDD)

Writes the report to `~/obsidian/ACE/` and commits+pushes to the vault git repo.

**Files:**
- Modify: `src/reporter.ts`
- Modify: `src/tests/reporter.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/tests/reporter.test.ts`:

```typescript
import { writeReport } from "../reporter.js";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

describe("writeReport", () => {
  it("writes the report file to obsidian/ACE/ and returns the file path", async () => {
    // Set up a real temp git repo to act as the vault
    const vaultDir = await mkdtemp(join(tmpdir(), "ace-test-vault-"));
    try {
      execSync(`git init "${vaultDir}"`);
      execSync(`git -C "${vaultDir}" config user.email "test@test.com"`);
      execSync(`git -C "${vaultDir}" config user.name "Test"`);
      execSync(`git -C "${vaultDir}" commit --allow-empty -m "init"`);

      const aceDir = join(vaultDir, "ACE");
      const result: AgentResult = {
        steps: [],
        answer: "Task complete.",
        usage: { inputTokens: 10, outputTokens: 5 },
        reason: "complete",
      };

      const filePath = await writeReport(
        "Fix the streak bug",
        "simonfallman/trending",
        result,
        vaultDir
      );

      // File should exist
      const content = await import("fs/promises").then(fs => fs.readFile(filePath, "utf-8"));
      expect(content).toContain("fix-the-streak-bug");
      expect(content).toContain("simonfallman/trending");

      // Should be committed in vault
      const log = execSync(`git -C "${vaultDir}" log --oneline`).toString();
      expect(log).toContain("ACE findings");
    } finally {
      await rm(vaultDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd ~/AutonomousCodeBaseEngineer && npm test -- src/tests/reporter.test.ts 2>&1 | tail -15
```

Expected: FAIL — `writeReport is not a function`

- [ ] **Step 3: Implement `writeReport()` in `src/reporter.ts`**

Add after `buildReport()`:

```typescript
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { simpleGit } from "simple-git";

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
  await git.push();

  return filePath;
}
```

- [ ] **Step 4: Run all tests**

```bash
cd ~/AutonomousCodeBaseEngineer && npm test 2>&1 | tail -20
```

Expected: all tests PASS (push will fail in test since there's no remote — that's fine, the test only checks commit)

Note: if `git.push()` throws in the test because there's no remote, wrap it in a try/catch that logs but doesn't rethrow — push failures should not crash the report write.

Update `writeReport()` to handle push failures gracefully:

```typescript
  try {
    await git.push();
  } catch (err) {
    console.error(`[reporter] Failed to push vault: ${err instanceof Error ? err.message : err}`);
  }
```

- [ ] **Step 5: Commit**

```bash
cd ~/AutonomousCodeBaseEngineer && git add src/reporter.ts src/tests/reporter.test.ts && git commit -m "Add writeReport() — writes and pushes findings to Obsidian vault"
```

---

### Task 3: Wire `writeReport()` into `solve_task`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Get the repo name from git remote inside `solve_task`**

In `src/index.ts`, import at the top:

```typescript
import { writeReport } from "./reporter.js";
import { simpleGit } from "simple-git";
import { getRepoPath } from "./repo.js";
import { homedir } from "os";
import { join } from "path";
```

- [ ] **Step 2: Add a helper to get the repo name from git remote**

Add after the imports in `src/index.ts`:

```typescript
async function getRepoName(): Promise<string> {
  try {
    const git = simpleGit(getRepoPath());
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === "origin");
    if (!origin?.refs?.fetch) return getRepoPath().split("/").slice(-1)[0];
    const match = origin.refs.fetch.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    return match ? match[1] : getRepoPath().split("/").slice(-1)[0];
  } catch {
    return getRepoPath().split("/").slice(-1)[0];
  }
}
```

- [ ] **Step 3: Extract commit hash from solve_task steps**

Add this helper after `getRepoName()`:

```typescript
function extractCommitHash(steps: import("./agent/loop.js").AgentStep[]): string | undefined {
  for (const step of steps) {
    if (step.type === "tool_result" && step.tool === "commit_changes" && step.output) {
      const match = step.output.match(/\b([a-f0-9]{7,40})\b/);
      if (match) return match[1];
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Call `writeReport()` at the end of `solve_task`**

In `src/index.ts`, inside the `solve_task` handler, after `const { steps, answer, usage, reason } = result;`, add:

```typescript
      // Write findings report to Obsidian vault (non-blocking — never fail the tool call)
      const vaultPath = join(homedir(), "obsidian");
      const repoName = await getRepoName();
      const commitHash = extractCommitHash(steps);
      writeReport(task, repoName, result, vaultPath, commitHash).catch((err) =>
        console.error(`[reporter] Failed to write findings: ${err instanceof Error ? err.message : err}`)
      );
```

- [ ] **Step 5: Build and verify it compiles**

```bash
cd ~/AutonomousCodeBaseEngineer && npm run build 2>&1
```

Expected: no TypeScript errors

- [ ] **Step 6: Run all tests**

```bash
cd ~/AutonomousCodeBaseEngineer && npm test 2>&1 | tail -20
```

Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
cd ~/AutonomousCodeBaseEngineer && git add src/index.ts && git commit -m "Wire writeReport() into solve_task — auto-publish findings to Obsidian vault"
```

---

### Task 4: Smoke test

Verify a real `solve_task` run produces a report in the vault.

**Files:** none modified

- [ ] **Step 1: Check the vault ACE directory doesn't exist yet**

```bash
ls ~/obsidian/ACE/ 2>/dev/null || echo "ACE dir not yet created — good"
```

- [ ] **Step 2: Register ACE in Claude Code MCP config**

Ensure `~/.claude/mcp.json` exists with:

```json
{
  "mcpServers": {
    "ace": {
      "command": "node",
      "args": ["/home/simon/AutonomousCodeBaseEngineer/dist/index.js"],
      "env": {
        "REPO_PATH": "/home/simon/projects",
        "AWS_REGION": "us-east-1",
        "AWS_ACCESS_KEY_ID": "YOUR_AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY": "YOUR_AWS_SECRET_ACCESS_KEY",
        "DATABASE_URL": "postgresql://postgres:YOUR_PASSWORD@172.17.0.1:5432/ace",
        "GITHUB_TOKEN": "YOUR_GITHUB_TOKEN"
      }
    }
  }
}
```

- [ ] **Step 3: Restart Claude Code session to load the MCP server**

Exit and reopen Claude Code. Verify ACE tools appear.

- [ ] **Step 4: Run a minimal solve_task**

Ask Claude Code: `"Use ace solve_task to list the files in the repo and summarize what it does"`

- [ ] **Step 5: Verify the report was written**

```bash
ls ~/obsidian/ACE/ && cat ~/obsidian/ACE/*.md | head -30
```

Expected: a `.md` file with the task slug, repo name, key findings, and result.

- [ ] **Step 6: Verify vault commit**

```bash
cd ~/obsidian && git log --oneline -3
```

Expected: top commit starts with `ACE findings:`

- [ ] **Step 7: Push ACE source to GitHub**

```bash
cd ~/AutonomousCodeBaseEngineer && git push
```
