import path from "path";
import fs from "fs";

let repoPath: string = process.env.REPO_PATH
  ? path.resolve(process.env.REPO_PATH)
  : process.cwd();

export function getRepoPath(): string {
  return repoPath;
}

export function setRepoPath(newPath: string): void {
  const resolvedPath = path.resolve(newPath);
  const gitDir = path.join(resolvedPath, ".git");
  
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
    throw new Error(`Invalid repository path: "${newPath}" does not exist or is not a directory.`);
  }
  if (!fs.existsSync(gitDir)) {
    throw new Error(`Invalid git repository: "${newPath}" does not contain a .git directory.`);
  }
  
  repoPath = resolvedPath;
}
