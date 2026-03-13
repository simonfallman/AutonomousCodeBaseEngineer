import path from "path";

let repoPath: string = process.env.REPO_PATH
  ? path.resolve(process.env.REPO_PATH)
  : process.cwd();

export function getRepoPath(): string {
  return repoPath;
}

export function setRepoPath(newPath: string): void {
  // TODO: validate that newPath is actually a git repository (contains a .git directory)
  // and throw a descriptive error if not, so users get clear feedback instead of cryptic git errors later
  repoPath = path.resolve(newPath);
}
