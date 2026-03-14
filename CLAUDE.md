# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Autonomous Codebase Engineer** is an MCP server that exposes tools enabling a language model to autonomously explore, understand, modify, test, and propose changes to any software repository. The top-level feature is `solve_task` — a ReAct agent loop where Claude plans and executes a task end-to-end using the other tools.

## Commands

```bash
npm run build      # compile TypeScript → dist/
npm run dev        # run with tsx (no compile step, for development)
npm start          # run compiled output
```

To point the server at a target repo:
```bash
REPO_PATH=/path/to/repo npm run dev
```

Copy `.env.example` to `.env` and fill in credentials before running.

## Stack

- **Runtime:** Node.js + TypeScript (`"type": "module"`, Node16 module resolution)
- **MCP SDK:** `@modelcontextprotocol/sdk` — stdio transport
- **LLM:** Amazon Bedrock — Claude Sonnet 4 (`us.anthropic.claude-sonnet-4-20250514-v1:0`), overridable via `BEDROCK_LLM_MODEL_ID`
- **Embeddings:** Amazon Titan Text Embeddings V2 (1024-dim) via Bedrock
- **Vector DB:** PostgreSQL + pgvector
- **Git:** `simple-git` for local operations, `@octokit/rest` for GitHub PRs

## Source Structure

```
src/
  index.ts            — MCP server entry point; all tool registrations
  repo.ts             — mutable repo path state (REPO_PATH env var + set_repo tool)
  chunker.ts          — walks repo, splits files into 300-line chunks with 30-line overlap
  embeddings/
    bedrock.ts        — Titan Embeddings V2 via InvokeModelCommand
  llm/
    bedrock.ts        — Claude completions via InvokeModelCommand (used by intelligence tools)
  vectordb/
    pg.ts             — pgvector schema setup, upsert, cosine similarity search
  agent/
    tools.ts          — tool registry (name → fn) + Claude tool_use JSON schemas
    loop.ts           — ReAct agent loop + planTask
  tools/
    navigation.ts     — list_files, read_file, write_file (path escape guard)
    testing.ts        — run_tests, run_linter, run_build (auto-detect or .ace.json)
    search.ts         — index_repository, semantic_search
    git.ts            — create_branch, commit_changes, push_branch, open_pull_request
    intelligence.ts   — summarize_file, find_function_usage, analyze_dependencies
```

## All MCP Tools (19)

| Group | Tools |
|---|---|
| Repo | `get_repo`, `set_repo` |
| Navigation | `list_files`, `read_file`, `write_file` |
| Testing | `run_tests`, `run_linter`, `run_build` |
| Semantic Search | `index_repository`, `semantic_search` |
| Git | `get_current_branch`, `create_branch`, `commit_changes`, `push_branch`, `open_pull_request` |
| Intelligence | `summarize_file`, `find_function_usage`, `analyze_dependencies` |
| Agent | `plan_task`, `solve_task` |

## Key Behaviors

**Test runner auto-detection** (`src/tools/testing.ts`): checks `.ace.json` first, then falls back to detecting `package.json`, `pytest.ini`, `Cargo.toml`, `go.mod`. Target repos can add `.ace.json` to override:
```json
{ "test": "npm run test:unit", "lint": "eslint .", "build": "tsc" }
```

**Path escape guard** (`src/tools/navigation.ts`): all file operations resolve against `getRepoPath()` and throw if the resolved path escapes the repo root.

**Protected branches** (`src/tools/git.ts`): `create_branch`, `push_branch`, and `open_pull_request` all block `main`, `master`, `production`, `prod`.

**ReAct agent loop** (`src/agent/loop.ts`): `solve_task` drives a multi-turn Bedrock conversation. Each turn Claude may call one or more tools; results are fed back as `tool_result` blocks. The loop exits when Claude produces a response with no tool calls or `max_iterations` is hit.

**Chunker skip list** (`src/chunker.ts`): ignores `node_modules`, `.git`, `dist`, `build`, `.next`, `__pycache__`, `.venv`, `venv`, `target`, `vendor`, and binary/lock file extensions.

## Environment Variables

| Variable | Purpose |
|---|---|
| `REPO_PATH` | Target repository path (default: `cwd`) |
| `AWS_REGION` | Bedrock region (default: `us-east-1`) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | AWS credentials |
| `BEDROCK_LLM_MODEL_ID` | Override Claude model (default: Claude Sonnet 4) |
| `DATABASE_URL` | PostgreSQL connection string for pgvector |
| `GITHUB_TOKEN` | GitHub PAT with `repo` scope (required for `open_pull_request`) |
