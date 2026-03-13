import fs from "fs/promises";
import path from "path";
import type { Chunk } from "./vectordb/pg.js";

const CHUNK_SIZE = 300; // lines
const CHUNK_OVERLAP = 30;

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "__pycache__",
  ".venv", "venv", "target", "vendor",
]);

export const LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript",
  ".js": "javascript", ".jsx": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".c": "c", ".h": "c",
  ".cpp": "cpp", ".cc": "cpp", ".hpp": "cpp",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".kt": "kotlin",
  ".md": "markdown",
  ".json": "json",
  ".yaml": "yaml", ".yml": "yaml",
  ".toml": "toml",
  ".sql": "sql",
  ".sh": "shell", ".bash": "shell",
};

const SKIP_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp",
  ".woff", ".woff2", ".ttf", ".eot",
  ".zip", ".tar", ".gz",
  ".lock", ".sum",
  ".map",
]);

async function collectFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".ace.json") continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectFiles(fullPath)));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!SKIP_EXTENSIONS.has(ext)) results.push(fullPath);
    }
  }
  return results;
}

export function chunkLines(lines: string[]): Array<{ start: number; end: number; text: string }> {
  const chunks: Array<{ start: number; end: number; text: string }> = [];
  let i = 0;
  while (i < lines.length) {
    const start = i;
    const end = Math.min(i + CHUNK_SIZE, lines.length);
    chunks.push({ start, end: end - 1, text: lines.slice(start, end).join("\n") });
    i += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

export async function chunkRepository(repoPath: string, repoName: string): Promise<Chunk[]> {
  const files = await collectFiles(repoPath);
  const allChunks: Chunk[] = [];

  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");
      const ext = path.extname(filePath).toLowerCase();
      const language = LANGUAGE_MAP[ext] ?? null;
      const relPath = path.relative(repoPath, filePath);

      for (const chunk of chunkLines(lines)) {
        allChunks.push({
          repo: repoName,
          filePath: relPath,
          startLine: chunk.start + 1,
          endLine: chunk.end + 1,
          language,
          content: chunk.text,
        });
      }
    } catch {
      // skip unreadable files (binary, permission errors, etc.)
    }
  }

  return allChunks;
}
