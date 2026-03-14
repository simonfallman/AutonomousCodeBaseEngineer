import path from "path";
import fs from "fs";

let repoPath: string = process.env.REPO_PATH
  ? path.resolve(process.env.REPO_PATH)
  : process.cwd();

/** Paths that should never be set as a repo root — system-critical directories. */
const BLOCKED_PATHS = new Set([
  "/",
  "/bin",
  "/dev",
  "/etc",
  "/lib",
  "/proc",
  "/sbin",
  "/sys",
  "/tmp",
  "/usr",
  "/var",
  "/boot",
  "/opt",
  "/root",
  "/run",
  "/snap",
]);

export function getRepoPath(): string {
  return repoPath;
}

export function setRepoPath(newPath: string): void {
  const resolvedPath = path.resolve(newPath);

  // Block system-critical directories to prevent full filesystem access
  if (BLOCKED_PATHS.has(resolvedPath)) {
    throw new Error(`Blocked: "${resolvedPath}" is a system directory and cannot be used as a repository root.`);
  }

  // Also block anything that is only 1 level deep from root on Unix (e.g. /home, /Users)
  // to prevent overly broad access, unless it has a .git directory.
  const depth = resolvedPath.split(path.sep).filter(Boolean).length;
  if (depth <= 1 && resolvedPath.startsWith("/")) {
    throw new Error(`Blocked: "${resolvedPath}" is too broad to use as a repository root. Provide a more specific path.`);
  }

  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
    throw new Error(`Invalid repository path: "${newPath}" does not exist or is not a directory.`);
  }

  const gitDir = path.join(resolvedPath, ".git");
  if (!fs.existsSync(gitDir)) {
    throw new Error(`Invalid git repository: "${newPath}" does not contain a .git directory.`);
  }

  repoPath = resolvedPath;
}
