import path from "path";
import crypto from "crypto";

export const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "__pycache__",
  ".venv", "venv", "target", "vendor",
]);

export const SKIP_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp",
  ".woff", ".woff2", ".ttf", ".eot",
  ".zip", ".tar", ".gz",
  ".lock", ".sum",
  ".map",
]);

export const MAX_FILE_SIZE = 1024 * 1024; // 1MB

/** Sensitive file patterns that should never be staged/committed automatically. */
export const SENSITIVE_PATTERNS = [
  /\.env$/,
  /\.env\..+$/,
  /credentials\.json$/,
  /\.pem$/,
  /\.key$/,
  /secret/i,
  /\.aws\/credentials$/,
];

/**
 * Generate a stable repo identifier from the full path to avoid collisions
 * when two repos have the same basename (e.g. both named "app").
 */
export function repoId(repoPath: string): string {
  const base = path.basename(repoPath);
  const hash = crypto.createHash("sha256").update(repoPath).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
}
