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
import { planTask, runAgentLoop } from "./agent/loop.js";
import { getRepoPath, setRepoPath } from "./repo.js";
import { startWatcher, stopWatcher, restartWatcher } from "./watcher.js";

function createServer(): McpServer {
  const server = new McpServer({
    name: "autonomous-codebase-engineer",
    version: "0.1.0",
  });

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
    async () => {
      const result = await indexRepository((msg) =>
        server.sendLoggingMessage({ level: "info", data: msg })
      );
      return { content: [{ type: "text", text: result }] };
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
    async ({ path }) => {
      const result = await summarizeFile(path);
      return { content: [{ type: "text", text: result }] };
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
    async ({ task }) => {
      const result = await planTask(task);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "solve_task",
    "Autonomously plan and execute a task using a ReAct agent loop (Claude + tools)",
    {
      task: z.string().describe("Natural language task description"),
      max_iterations: z
        .number()
        .int()
        .min(1)
        .max(30)
        .default(15)
        .describe("Max tool-call iterations before stopping"),
    },
    async ({ task, max_iterations }) => {
      const { steps, answer, usage } = await runAgentLoop(task, max_iterations, (msg) => {
        server.sendLoggingMessage({ level: "info", data: msg });
      });

      const log = steps
        .map((s) => {
          if (s.type === "tool_call") return `→ ${s.tool}(${JSON.stringify(s.input)})`;
          if (s.type === "tool_result") return `← ${s.tool}: ${s.output?.slice(0, 300)}${(s.output?.length ?? 0) > 300 ? "…" : ""}`;
          return `\n✓ ${s.text}`;
        })
        .join("\n");

      const tokenSummary = `Tokens: ${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out`;
      return { content: [{ type: "text", text: `${log}\n\n---\n${answer}\n\n${tokenSummary}` }] };
    }
  );

  return server;
}

// --- Start ---

const USE_SSE = process.env.MCP_TRANSPORT === "sse";

if (USE_SSE) {
  const PORT = parseInt(process.env.PORT ?? "3001");
  const sessions = new Map<string, { transport: SSEServerTransport; server: McpServer }>();

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost`);

    if (req.method === "GET" && url.pathname === "/sse") {
      const transport = new SSEServerTransport("/mcp/message", res);
      const server = createServer();
      sessions.set(transport.sessionId, { transport, server });
      res.on("close", () => {
        sessions.delete(transport.sessionId);
        if (sessions.size === 0) stopWatcher();
      });
      await server.connect(transport);
      startWatcher();
    } else if (req.method === "POST" && (url.pathname === "/message" || url.pathname === "/mcp/message")) {
      const sessionId = url.searchParams.get("sessionId") ?? "";
      const session = sessions.get(sessionId);
      if (!session) { res.writeHead(404).end("Session not found"); return; }
      await session.transport.handlePostMessage(req, res);
    } else if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", sessions: sessions.size }));
    } else {
      res.writeHead(404).end("Not found");
    }
  });

  httpServer.listen(PORT, () => {
    console.error(`ACE MCP server listening on port ${PORT} (SSE)`);
    indexRepository().then((msg) => console.error(`[index] ${msg}`)).catch((err) => console.error(`[index] Failed:`, err));
  });
} else {
  const transport = new StdioServerTransport();
  const server = createServer();
  transport.onclose = () => stopWatcher();
  await server.connect(transport);
  startWatcher();
  indexRepository().then((msg) => console.error(`[index] ${msg}`)).catch((err) => console.error(`[index] Failed:`, err));
}
