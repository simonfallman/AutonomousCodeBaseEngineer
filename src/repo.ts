import path from "path";
import fs from "fs";

let repoPath: string = process.env.REPO_PATH
  ? path.resolve(process.env.REPO_PATH)
  : process.cwd();

export function getRepoPath(): string {
  return repoPath;
}

export function setRepoPath(newPath: string): void {
  const resolved = path.resolve(newPath);
  const gitDir = path.join(resolved, ".git");
  if (!fs.existsSync(gitDir)) {
    throw new Error(
      `"${resolved}" is not a git repository (no .git directory found). ` +
        `Please provide a valid git repository path.`
    );
  }
  repoPath = resolved;
}
