import { listFiles, readFile, writeFile, deleteFile, searchFiles, grepRepo, applyPatch } from "../tools/navigation.js";
import { runTests, runLinter, runBuild } from "../tools/testing.js";
import { indexRepository, semanticSearch } from "../tools/search.js";
import { getCurrentBranch, createBranch, commitChanges, pushBranch, openPullRequest } from "../tools/git.js";
import { summarizeFile, findFunctionUsage, analyzeDependencies } from "../tools/intelligence.js";

export type ToolFn = (input: Record<string, unknown>) => Promise<string>;

export const TOOL_REGISTRY: Record<string, ToolFn> = {
  list_files: ({ path }) => listFiles((path as string) ?? "."),
  read_file: ({ path }) => readFile(path as string),
  write_file: ({ path, content }) => writeFile(path as string, content as string),
  delete_file: ({ path }) => deleteFile(path as string),
  search_files: ({ pattern }) => searchFiles(pattern as string),
  grep: ({ pattern, path }) => grepRepo(pattern as string, path as string | undefined),
  apply_patch: ({ path, diff }) => applyPatch(path as string, diff as string),
  run_tests: () => runTests(),
  run_linter: () => runLinter(),
  run_build: () => runBuild(),
  semantic_search: ({ query, limit }) => semanticSearch(query as string, (limit as number) ?? 5),
  index_repository: () => indexRepository(),
  get_current_branch: () => getCurrentBranch(),
  create_branch: ({ name }) => createBranch(name as string),
  commit_changes: ({ message }) => commitChanges(message as string),
  push_branch: () => pushBranch(),
  open_pull_request: ({ title, body, base }) =>
    openPullRequest(title as string, body as string, (base as string) ?? "main"),
  summarize_file: ({ path }) => summarizeFile(path as string),
  find_function_usage: ({ name }) => findFunctionUsage(name as string),
  analyze_dependencies: () => analyzeDependencies(),
};

// Claude tool_use schema definitions
export const TOOL_SCHEMAS = [
  {
    name: "list_files",
    description: "List files and directories at a path within the repo",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Directory path relative to repo root (default: .)" } },
    },
  },
  {
    name: "read_file",
    description: "Read a file's contents from the repo",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file in the repo",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "delete_file",
    description: "Delete a file from the repo",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "search_files",
    description: "Find files by glob pattern (e.g. '**/*.ts', 'src/**/*.test.ts')",
    input_schema: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
    },
  },
  {
    name: "grep",
    description: "Search file contents by regex across the repo",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regular expression" },
        path: { type: "string", description: "Optional subdirectory to narrow search" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "apply_patch",
    description: "Apply a unified diff patch to a file",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        diff: { type: "string", description: "Unified diff string" },
      },
      required: ["path", "diff"],
    },
  },
  {
    name: "run_tests",
    description: "Run the repo's test suite",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "run_linter",
    description: "Run the repo's linter",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "run_build",
    description: "Run the repo's build command",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "semantic_search",
    description: "Search the repo by meaning using vector embeddings",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", description: "Number of results (default: 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "index_repository",
    description: "Chunk and embed the repo into the vector database for semantic search",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_current_branch",
    description: "Get the current git branch name",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_branch",
    description: "Create and switch to a new git branch",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "commit_changes",
    description: "Stage all changes and create a git commit",
    input_schema: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    },
  },
  {
    name: "push_branch",
    description: "Push the current branch to origin",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "open_pull_request",
    description: "Open a GitHub pull request from the current branch",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        base: { type: "string", description: "Base branch (default: main)" },
      },
      required: ["title", "body"],
    },
  },
  {
    name: "summarize_file",
    description: "Summarize a file's purpose, exports, and key patterns using Claude",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "find_function_usage",
    description: "Find all occurrences of a function or symbol name across the repo",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "analyze_dependencies",
    description: "Parse the repo's dependency files and return a summary",
    input_schema: { type: "object", properties: {} },
  },
];
