import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { getRepoPath } from "../repo.js";

const execFileAsync = promisify(execFile);

interface AceConfig {
  test?: string;
  lint?: string;
  build?: string;
}

async function readAceConfig(repoPath: string): Promise<AceConfig> {
  try {
    const raw = await fs.readFile(path.join(repoPath, ".ace.json"), "utf-8");
    return JSON.parse(raw);
  } catch (err: any) {
    // ENOENT just means no config file — that's fine and expected
    if (err?.code !== "ENOENT") {
      console.error("[ace config] Failed to parse .ace.json — using defaults:", err);
    }
    return {};
  }
}

async function detectTestCommand(repoPath: string): Promise<string> {
  const config = await readAceConfig(repoPath);
  if (config.test) return config.test;

  // Check package.json for test script
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(repoPath, "package.json"), "utf-8"));
    if (pkg.scripts?.test && !pkg.scripts.test.includes("no test specified")) {
      return "npm test";
    }
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      console.error("[detectTestCommand] Failed to read or parse package.json:", err);
    }
  }

  // Python
  for (const f of ["pytest.ini", "pyproject.toml", "setup.py"]) {
    try {
      await fs.access(path.join(repoPath, f));
      return "pytest";
    } catch {
      // file not present — try next candidate
    }
  }

  // Rust
  try {
    await fs.access(path.join(repoPath, "Cargo.toml"));
    return "cargo test";
  } catch {
    // file not present — try next candidate
  }

  // Go
  try {
    await fs.access(path.join(repoPath, "go.mod"));
    return "go test ./...";
  } catch {
    // file not present — no runner detected
  }

  throw new Error(
    "Could not detect a test runner. Add a .ace.json with { \"test\": \"<command>\" } to the repo root."
  );
}

async function runCommand(command: string, cwd: string): Promise<string> {
  const [bin, ...args] = command.split(" ");
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, { cwd });
    return [stdout, stderr].filter(Boolean).join("\n");
  } catch (err: any) {
    // Non-zero exit (e.g. failing tests) — return output so agent can read it
    const out = [err.stdout, err.stderr].filter(Boolean).join("\n");
    return out || err.message;
  }
}

export async function runTests(): Promise<string> {
  const repoPath = getRepoPath();
  const command = await detectTestCommand(repoPath);
  const output = await runCommand(command, repoPath);
  return `$ ${command}\n\n${output}`;
}

export async function runLinter(): Promise<string> {
  const repoPath = getRepoPath();
  const config = await readAceConfig(repoPath);
  const command = config.lint ?? "npm run lint";
  const output = await runCommand(command, repoPath);
  return `$ ${command}\n\n${output}`;
}

export async function runBuild(): Promise<string> {
  const repoPath = getRepoPath();
  const config = await readAceConfig(repoPath);
  const command = config.build ?? "npm run build";
  const output = await runCommand(command, repoPath);
  return `$ ${command}\n\n${output}`;
}
