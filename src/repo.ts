import path from "path";

let repoPath: string = process.env.REPO_PATH
  ? path.resolve(process.env.REPO_PATH)
  : process.cwd();

export function getRepoPath(): string {
  return repoPath;
}

export function setRepoPath(newPath: string): void {
  repoPath = path.resolve(newPath);
}
