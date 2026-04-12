import "dotenv/config";
import http from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { listFiles, readFile, writeFile, deleteFile, searchFiles, grepRepo, applyPatch } from "./tools/navigation.js";
import { runTests, runLinter, runBuild } from "./tools/testing.js";
import { indexRepository, semanticSearch } from "./tools/search.js";
import { createBranch, getCurrentBranch, commitChanges, pushBranch, openPullRequest } from "./tools/git.js";
import { summarizeFile, findFunctionUsage, analyzeDependencies } from "./tools/intelligence.js";
import { planTask, runCoordinatedLoop, type AgentStep } from "./agent/loop.js";
import { getRepoPath, setRepoPath } from "./repo.js";
import { startWatcher, stopWatcher, restartWatcher } from "./watcher.js";
import { writeReport } from "./reporter.js";
import { simpleGit } from "simple-git";
import { homedir } from "os";
import { join } from "path";

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


function createServer(): McpServer {
  const server = new McpServer({
    name: "autonomous-codebase-engineer",
    version: "0.2.0",
  });

  // Helper: send a progress notification if the client provided a progressToken
  function sendProgress(extra: { _meta?: { progressToken?: string | number }; sendNotification: (n: any) => Promise<void> }, progress: number, total: number, message?: string) {
    const token = extra._meta?.progressToken;
    if (token === undefined) return;
    extra.sendNotification({
      method: "notifications/progress",
      params: { progressToken: token, progress, total, ...(message ? { message } : {}) },
    }).catch(() => { /* ignore notification failures */ });
  }

  // Helper: start a heartbeat that sends progress notifications every 15s to prevent MCP client timeout (default 60s).
  // Returns a stop function.
  function startHeartbeat(extra: Parameters<typeof sendProgress>[0], label: string): () => void {
    let tick = 0;
    const interval = setInterval(() => {
      tick++;
      sendProgress(extra, tick, tick + 1, `[heartbeat] ${label} still running…`);
    }, 15_000);
    return () => clearInterval(interval);
  }

  // --- Repo management ---

  server.tool(
    "get_repo",
    "Get the current repository path",
    {},
    async () => ({
      content: [{ type: "text", text: getRepoPath() }],
    })
  );

  server.tool(
    "set_repo",
    "Change the target repository path",
    { path: z.string().describe("Absolute or relative path to the repository root") },
    async ({ path }) => {
      setRepoPath(path);
      await restartWatcher();
      // Re-index in the background so semantic search works immediately on the new repo
      indexRepository().catch((err) => console.error(`[index] Failed after set_repo:`, err));
      return { content: [{ type: "text", text: `Repo set to: ${getRepoPath()}` }] };
    }
  );

  // --- Navigation ---

  server.tool(
    "list_files",
    "List files and directories at a path within the repo",
    { path: z.string().default(".").describe("Directory path relative to repo root") },
    async ({ path }) => {
      const result = await listFiles(path);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "read_file",
    "Read a file's contents from the repo",
    { path: z.string().describe("File path relative to repo root") },
    async ({ path }) => {
      const result = await readFile(path);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "write_file",
    "Write content to a file in the repo (creates directories as needed)",
    {
      path: z.string().describe("File path relative to repo root"),
      content: z.string().describe("Content to write"),
    },
    async ({ path, content }) => {
      const result = await writeFile(path, content);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "delete_file",
    "Delete a file from the repo",
    { path: z.string().describe("File path relative to repo root") },
    async ({ path }) => {
      const result = await deleteFile(path);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "search_files",
    "Find files in the repo by glob pattern (e.g. '**/*.ts', 'src/**/*.test.ts')",
    { pattern: z.string().describe("Glob pattern") },
    async ({ pattern }) => {
      const result = await searchFiles(pattern);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "grep",
    "Search file contents by regex pattern across the repo",
    {
      pattern: z.string().describe("Regular expression to search for"),
      path: z.string().optional().describe("Narrow search to this subdirectory (relative to repo root)"),
    },
    async ({ pattern, path }) => {
      const result = await grepRepo(pattern, path);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "apply_patch",
    "Apply a unified diff patch to a file in the repo",
    {
      path: z.string().describe("File path relative to repo root"),
      diff: z.string().describe("Unified diff string to apply"),
    },
    async ({ path, diff }) => {
      const result = await applyPatch(path, diff);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // --- Testing & validation ---

  server.tool(
    "run_tests",
    "Run the repo's test suite (auto-detected or configured via .ace.json)",
    {},
    async () => {
      const result = await runTests();
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "run_linter",
    "Run the repo's linter (auto-detected or configured via .ace.json)",
    {},
    async () => {
      const result = await runLinter();
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "run_build",
    "Run the repo's build command (auto-detected or configured via .ace.json)",
    {},
    async () => {
      const result = await runBuild();
      return { content: [{ type: "text", text: result }] };
    }
  );

  // --- Semantic search ---

  server.tool(
    "index_repository",
    "Chunk and embed the current repo into the vector database for semantic search",
    {},
    async (_args, extra) => {
      let step = 0;
      const stopHeartbeat = startHeartbeat(extra, "index_repository");
      try {
        const result = await indexRepository((msg) => {
          step++;
          server.sendLoggingMessage({ level: "info", data: msg });
          sendProgress(extra, step, step + 1, msg);
        });
        return { content: [{ type: "text", text: result }] };
      } finally {
        stopHeartbeat();
      }
    }
  );

  server.tool(
    "semantic_search",
    "Search the repo by meaning using vector embeddings",
    {
      query: z.string().describe("Natural language query, e.g. 'Where is authentication handled?'"),
      limit: z.number().int().min(1).max(20).default(5).describe("Number of results to return"),
    },
    async ({ query, limit }) => {
      const result = await semanticSearch(query, limit);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // --- Git ---

  server.tool(
    "get_current_branch",
    "Get the current git branch of the repo",
    {},
    async () => {
      const result = await getCurrentBranch();
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "create_branch",
    "Create and switch to a new git branch (protected branches are blocked)",
    { name: z.string().describe("Branch name") },
    async ({ name }) => {
      const result = await createBranch(name);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "commit_changes",
    "Stage all changes and create a git commit",
    { message: z.string().describe("Commit message") },
    async ({ message }) => {
      const result = await commitChanges(message);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "push_branch",
    "Push the current branch to origin (blocked on protected branches)",
    {},
    async () => {
      const result = await pushBranch();
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "open_pull_request",
    "Open a GitHub pull request from the current branch",
    {
      title: z.string().describe("PR title"),
      body: z.string().describe("PR description (markdown)"),
      base: z.string().default("main").describe("Base branch to merge into"),
    },
    async ({ title, body, base }) => {
      const result = await openPullRequest(title, body, base);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // --- Code intelligence ---

  server.tool(
    "summarize_file",
    "Ask Claude to summarize a file's purpose, exports, and key patterns",
    { path: z.string().describe("File path relative to repo root") },
    async ({ path }, extra) => {
      const stopHeartbeat = startHeartbeat(extra, "summarize_file");
      try {
        const result = await summarizeFile(path);
        return { content: [{ type: "text", text: result }] };
      } finally {
        stopHeartbeat();
      }
    }
  );

  server.tool(
    "find_function_usage",
    "Find all occurrences of a function or symbol name across the repo",
    { name: z.string().describe("Function or symbol name to search for") },
    async ({ name }) => {
      const result = await findFunctionUsage(name);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "analyze_dependencies",
    "Parse the repo's dependency files and return a summary of all dependencies",
    {},
    async () => {
      const result = await analyzeDependencies();
      return { content: [{ type: "text", text: result }] };
    }
  );

  // --- Autonomous agent ---

  server.tool(
    "plan_task",
    "Ask Claude to produce a step-by-step plan for a task without executing anything",
    { task: z.string().describe("Natural language task description") },
    async ({ task }, extra) => {
      const stopHeartbeat = startHeartbeat(extra, "plan_task");
      try {
        const result = await planTask(task);
        return { content: [{ type: "text", text: result }] };
      } finally {
        stopHeartbeat();
      }
    }
  );

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
        .describe("Total iteration budget split between planning and execution phases"),
    },
    async ({ task, max_iterations }, extra) => {
      const stopHeartbeat = startHeartbeat(extra, "solve_task");
      const abortController = new AbortController();

      let coordResult: Awaited<ReturnType<typeof runCoordinatedLoop>>;
      try {
        coordResult = await runCoordinatedLoop(task, max_iterations, (msg) => {
          server.sendLoggingMessage({ level: "info", data: msg });
          sendProgress(extra, 0, 1, msg);
        }, abortController.signal);
      } finally {
        stopHeartbeat();
      }

      const { plan, executionResults, answer } = coordResult;

      // Write findings to Obsidian vault (non-blocking — never fail the tool call)
      const vaultPath = join(homedir(), "obsidian");
      getRepoName().then((repoName) => {
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

  return server;
}

// --- Start ---

if (process.env.MCP_TRANSPORT === "sse") {
  const port = parseInt(process.env.PORT ?? "3001");
  const transports: Record<string, SSEServerTransport> = {};

  const postPath = process.env.MCP_POST_PATH ?? "/message";

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost`);
    if (req.method === "GET" && url.pathname === "/sse") {
      const transport = new SSEServerTransport(postPath, res);
      transports[transport.sessionId] = transport;
      res.on("close", () => delete transports[transport.sessionId]);
      const server = createServer();
      await server.connect(transport);
      startWatcher();
      indexRepository().then((msg) => console.error(`[index] ${msg}`)).catch((err) => console.error(`[index] Failed:`, err));
    } else if (req.method === "POST" && url.pathname === "/message") {
      const sessionId = url.searchParams.get("sessionId") ?? "";
      const transport = transports[sessionId];
      if (transport) {
        await transport.handlePostMessage(req, res);
      } else {
        res.writeHead(404).end("Session not found");
      }
    } else {
      res.writeHead(404).end("Not found");
    }
  });

  httpServer.listen(port, () => console.error(`[sse] Listening on port ${port}`));
} else {
  const transport = new StdioServerTransport();
  const server = createServer();
  transport.onclose = () => stopWatcher();
  await server.connect(transport);
  startWatcher();
  indexRepository().then((msg) => console.error(`[index] ${msg}`)).catch((err) => console.error(`[index] Failed:`, err));
}
