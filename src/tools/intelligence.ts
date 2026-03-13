import fs from "fs/promises";
import path from "path";
import { getRepoPath } from "../repo.js";
import { complete } from "../llm/bedrock.js";
import { readFile } from "./navigation.js";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "__pycache__",
  ".venv", "venv", "target", "vendor",
]);

// --- summarize_file ---

export async function summarizeFile(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return complete(
    "You are a senior software engineer. Summarize the provided source file concisely: its purpose, key exports/classes/functions, and any important patterns or dependencies. Be direct and technical.",
    `File: ${filePath}\n\n\`\`\`\n${content}\n\`\`\``
  );
}

// --- find_function_usage ---

interface UsageMatch {
  filePath: string;
  line: number;
  context: string;
}

async function searchInFile(
  absPath: string,
  relPath: string,
  name: string
): Promise<UsageMatch[]> {
  let content: string;
  try {
    content = await fs.readFile(absPath, "utf-8");
  } catch {
    return [];
  }

  const lines = content.split("\n");
  const matches: UsageMatch[] = [];
  // Match calls like `name(`, `name<`, `.name(`, and imports of `name`
  const callRe = new RegExp(`\\b${escapeRegex(name)}\\s*[(<]|\\b${escapeRegex(name)}\\b`);

  for (let i = 0; i < lines.length; i++) {
    if (callRe.test(lines[i])) {
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length - 1, i + 1);
      matches.push({
        filePath: relPath,
        line: i + 1,
        context: lines.slice(start, end + 1).join("\n"),
      });
    }
  }
  return matches;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function walkRepo(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkRepo(full)));
    } else {
      results.push(full);
    }
  }
  return results;
}

export async function findFunctionUsage(name: string): Promise<string> {
  const repoPath = getRepoPath();
  const files = await walkRepo(repoPath);
  const allMatches: UsageMatch[] = [];

  for (const absPath of files) {
    const relPath = path.relative(repoPath, absPath);
    const matches = await searchInFile(absPath, relPath, name);
    allMatches.push(...matches);
  }

  if (allMatches.length === 0) {
    return `No usages of "${name}" found.`;
  }

  const lines = [`Found ${allMatches.length} occurrence(s) of "${name}":\n`];
  for (const m of allMatches) {
    lines.push(`### ${m.filePath}:${m.line}\n\`\`\`\n${m.context}\n\`\`\``);
  }
  return lines.join("\n");
}

// --- analyze_dependencies ---

interface DepFile {
  label: string;
  parse: (content: string) => string;
}

const DEP_FILES: Record<string, DepFile> = {
  "package.json": {
    label: "Node.js (package.json)",
    parse(content) {
      const pkg = JSON.parse(content);
      const deps = Object.keys(pkg.dependencies ?? {});
      const dev = Object.keys(pkg.devDependencies ?? {});
      return `Dependencies (${deps.length}): ${deps.join(", ") || "none"}\nDev dependencies (${dev.length}): ${dev.join(", ") || "none"}`;
    },
  },
  "requirements.txt": {
    label: "Python (requirements.txt)",
    parse(content) {
      const pkgs = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
      return `Packages (${pkgs.length}):\n${pkgs.join("\n")}`;
    },
  },
  "pyproject.toml": {
    label: "Python (pyproject.toml)",
    parse(content) {
      const matches = [...content.matchAll(/^\s*([\w-]+)\s*=/gm)].map((m) => m[1]);
      return `Detected keys: ${matches.join(", ")}`;
    },
  },
  "Cargo.toml": {
    label: "Rust (Cargo.toml)",
    parse(content) {
      const section = content.match(/\[dependencies\]([\s\S]*?)(\[|$)/)?.[1] ?? "";
      const pkgs = section.split("\n").filter((l) => l.includes("=")).map((l) => l.split("=")[0].trim());
      return `Crates (${pkgs.length}): ${pkgs.join(", ") || "none"}`;
    },
  },
  "go.mod": {
    label: "Go (go.mod)",
    parse(content) {
      const reqs = [...content.matchAll(/^\s*require\s+([\w./]+)/gm)].map((m) => m[1]);
      const block = content.match(/require \(([\s\S]*?)\)/)?.[1] ?? "";
      const blockPkgs = block.split("\n").filter((l) => l.trim()).map((l) => l.trim().split(/\s/)[0]);
      const all = [...new Set([...reqs, ...blockPkgs])];
      return `Modules (${all.length}): ${all.join(", ") || "none"}`;
    },
  },
};

export async function analyzeDependencies(): Promise<string> {
  const repoPath = getRepoPath();
  const results: string[] = [];

  for (const [filename, { label, parse }] of Object.entries(DEP_FILES)) {
    try {
      const content = await fs.readFile(path.join(repoPath, filename), "utf-8");
      results.push(`## ${label}\n${parse(content)}`);
    } catch {
      // file doesn't exist in this repo — skip
    }
  }

  if (results.length === 0) {
    return "No recognized dependency files found (package.json, requirements.txt, Cargo.toml, go.mod, pyproject.toml).";
  }

  return results.join("\n\n");
}
