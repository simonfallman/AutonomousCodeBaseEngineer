import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "url";
import path from "path";

// Resolve the repo root so the server runs against the right directory
const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../../");

// All 21 tools that should be registered (including grep, apply_patch, search_files, delete_file)
const EXPECTED_TOOLS = [
  "get_repo", "set_repo",
  "list_files", "read_file", "write_file", "delete_file",
  "search_files", "grep", "apply_patch",
  "run_tests", "run_linter", "run_build",
  "index_repository", "semantic_search",
  "get_current_branch", "create_branch", "commit_changes", "push_branch", "open_pull_request",
  "summarize_file", "find_function_usage", "analyze_dependencies",
  "plan_task", "solve_task",
];

describe("MCP server — stdio connection", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: "tsx",
      args: ["src/index.ts"],
      env: {
        ...process.env,
        REPO_PATH: repoRoot,
      },
      cwd: repoRoot,
      stderr: "pipe", // suppress server log noise in test output
    });

    client = new Client({ name: "test-client", version: "0.0.1" });
    await client.connect(transport);
  }, 15_000);

  afterAll(async () => {
    await client.close();
  });

  it("lists all expected tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    for (const expected of EXPECTED_TOOLS) {
      expect(names, `missing tool: ${expected}`).toContain(expected);
    }
  });

  it("every tool has a description and input_schema", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description, `${tool.name} missing description`).toBeTruthy();
      expect(tool.inputSchema, `${tool.name} missing inputSchema`).toBeDefined();
    }
  });

  it("get_repo returns a non-empty path", async () => {
    const result = await client.callTool({ name: "get_repo", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(text).toBeTruthy();
    expect(text).toMatch(/^\//); // absolute path
  });

  it("list_files returns repo contents including src/", async () => {
    const result = await client.callTool({ name: "list_files", arguments: { path: "." } });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(text).toContain("src/");
    expect(text).toContain("package.json");
  });

  it("read_file returns file contents", async () => {
    const result = await client.callTool({ name: "read_file", arguments: { path: "package.json" } });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    const pkg = JSON.parse(text);
    expect(pkg.name).toBe("autonomouscodebaseengineer");
  });

  it("grep finds matches across the repo", async () => {
    const result = await client.callTool({
      name: "grep",
      arguments: { pattern: "runCoordinatedLoop", path: "src" },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(text).toContain("loop.ts");
  });

  it("search_files matches by glob pattern", async () => {
    const result = await client.callTool({
      name: "search_files",
      arguments: { pattern: "src/agent/*.ts" },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(text).toContain("loop.ts");
    expect(text).toContain("tools.ts");
    expect(text).toContain("planner.ts");
    expect(text).toContain("executor.ts");
  });

  it("read_file rejects path traversal", async () => {
    const result = await client.callTool({
      name: "read_file",
      arguments: { path: "../../etc/passwd" },
    });
    // MCP returns errors as isError: true with error text
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(text).toContain("escapes repo root");
  });
});
