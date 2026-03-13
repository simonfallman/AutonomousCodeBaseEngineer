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
  } catch {
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
  } catch {}

  // Python
  for (const f of ["pytest.ini", "pyproject.toml", "setup.py"]) {
    try {
      await fs.access(path.join(repoPath, f));
      return "pytest";
    } catch {}
  }

  // Rust
  try {
    await fs.access(path.join(repoPath, "Cargo.toml"));
    return "cargo test";
  } catch {}

  // Go
  try {
    await fs.access(path.join(repoPath, "go.mod"));
    return "go test ./...";
  } catch {}

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
