import fs from "fs/promises";
import path from "path";
import { glob } from "glob";
import { applyPatch as diffApplyPatch } from "diff";
import { getRepoPath } from "../repo.js";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "__pycache__",
  ".venv", "venv", "target", "vendor",
]);

const MAX_GREP_MATCHES = 200;

export function resolveSafe(relativePath: string): string {
  const repo = getRepoPath();
  const resolved = path.resolve(repo, relativePath);
  if (!resolved.startsWith(repo + path.sep) && resolved !== repo) {
    throw new Error(`Path escapes repo root: ${relativePath}`);
  }
  return resolved;
}

export async function listFiles(dirPath: string = "."): Promise<string> {
  const target = resolveSafe(dirPath);
  const entries = await fs.readdir(target, { withFileTypes: true });
  const lines = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  return lines.join("\n");
}

export async function readFile(filePath: string): Promise<string> {
  const target = resolveSafe(filePath);
  return fs.readFile(target, "utf-8");
}

export async function writeFile(filePath: string, content: string): Promise<string> {
  const target = resolveSafe(filePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf-8");
  return `Written: ${filePath}`;
}

export async function deleteFile(filePath: string): Promise<string> {
  const target = resolveSafe(filePath);
  await fs.unlink(target);
  return `Deleted: ${filePath}`;
}

export async function searchFiles(pattern: string): Promise<string> {
  const repoPath = getRepoPath();
  const matches = await glob(pattern, {
    cwd: repoPath,
    dot: false,
    ignore: [...SKIP_DIRS].map((d) => `${d}/**`),
  });
  if (matches.length === 0) return `No files matched: ${pattern}`;
  return matches.sort().join("\n");
}

async function walkFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkFiles(full)));
    } else {
      results.push(full);
    }
  }
  return results;
}

export async function grepRepo(pattern: string, searchPath?: string): Promise<string> {
  const repoPath = getRepoPath();
  const baseDir = searchPath ? resolveSafe(searchPath) : repoPath;
  const files = await walkFiles(baseDir);

  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch (err) {
    console.error(`[grep] Invalid regex pattern "${pattern}":`, err);
    return `Invalid regex pattern: ${pattern}`;
  }
  const lines: string[] = [];
  let truncated = false;

  outer: for (const absPath of files) {
    let content: string;
    try {
      content = await fs.readFile(absPath, "utf-8");
    } catch (err) {
      console.error(`[grep] Failed to read file "${path.relative(repoPath, absPath)}" — skipping:`, err);
      continue;
    }
    const fileLines = content.split("\n");
    const relPath = path.relative(repoPath, absPath);
    for (let i = 0; i < fileLines.length; i++) {
      if (re.test(fileLines[i])) {
        lines.push(`${relPath}:${i + 1}: ${fileLines[i]}`);
        if (lines.length >= MAX_GREP_MATCHES) {
          truncated = true;
          break outer;
        }
      }
    }
  }

  if (lines.length === 0) return `No matches for: ${pattern}`;
  if (truncated) lines.push(`\n(truncated at ${MAX_GREP_MATCHES} matches)`);
  return lines.join("\n");
}

export async function applyPatch(filePath: string, diff: string): Promise<string> {
  const target = resolveSafe(filePath);
  const original = await fs.readFile(target, "utf-8");
  const patched = diffApplyPatch(original, diff);
  if (patched === false) {
    throw new Error(`Patch failed to apply to ${filePath} — hunk offsets may be wrong.`);
  }
  await fs.writeFile(target, patched, "utf-8");
  return `Patch applied: ${filePath}`;
}
