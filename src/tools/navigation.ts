import fs from "fs/promises";
import { realpathSync } from "fs";
import path from "path";
import { glob } from "glob";
import { applyPatch as diffApplyPatch } from "diff";
import { getRepoPath } from "../repo.js";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "__pycache__",
  ".venv", "venv", "target", "vendor",
]);

const MAX_GREP_MATCHES = 200;
const MAX_READ_SIZE = 2 * 1024 * 1024; // 2MB max file read
const REGEX_MAX_LENGTH = 500; // guard against ReDoS with overly long patterns

export function resolveSafe(relativePath: string): string {
  const repo = getRepoPath();
  const resolved = path.resolve(repo, relativePath);

  // First check: logical path must be within repo (catches ../.. traversal)
  if (!resolved.startsWith(repo + path.sep) && resolved !== repo) {
    throw new Error(`Path escapes repo root: ${relativePath}`);
  }

  // Second check: if the file exists, verify the real path (catches symlink escapes)
  try {
    const real = realpathSync(resolved);
    const realRepo = realpathSync(repo);
    if (!real.startsWith(realRepo + path.sep) && real !== realRepo) {
      throw new Error(`Path escapes repo root: ${relativePath}`);
    }
  } catch (err) {
    // File doesn't exist yet — that's fine, the logical check above passed
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
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
  const stats = await fs.stat(target);
  if (stats.size > MAX_READ_SIZE) {
    throw new Error(`File too large to read (${(stats.size / 1024 / 1024).toFixed(2)}MB, max ${MAX_READ_SIZE / 1024 / 1024}MB): ${filePath}`);
  }
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

function validateRegex(pattern: string): RegExp | string {
  if (pattern.length > REGEX_MAX_LENGTH) {
    return `Regex pattern too long (${pattern.length} chars, max ${REGEX_MAX_LENGTH}). Use a simpler pattern.`;
  }
  try {
    return new RegExp(pattern);
  } catch {
    return `Invalid regex pattern: ${pattern}`;
  }
}

export async function grepRepo(pattern: string, searchPath?: string): Promise<string> {
  const repoPath = getRepoPath();
  const baseDir = searchPath ? resolveSafe(searchPath) : repoPath;
  const files = await walkFiles(baseDir);

  const reOrError = validateRegex(pattern);
  if (typeof reOrError === "string") return reOrError;
  const re = reOrError;
  const lines: string[] = [];
  let truncated = false;

  outer: for (const absPath of files) {
    let content: string;
    try {
      const stats = await fs.stat(absPath);
      if (stats.size > MAX_READ_SIZE) continue; // skip huge files
      content = await fs.readFile(absPath, "utf-8");
    } catch {
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
