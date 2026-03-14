import { simpleGit } from "simple-git";
import { Octokit } from "@octokit/rest";
import { getRepoPath } from "../repo.js";
import { SENSITIVE_PATTERNS } from "../constants.js";

const PROTECTED_BRANCHES = new Set(["main", "master", "production", "prod"]);

function git() {
  return simpleGit(getRepoPath());
}

function octokit() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN env var is required for GitHub operations.");
  return new Octokit({ auth: token });
}

async function getRemoteOwnerRepo(): Promise<{ owner: string; repo: string }> {
  const remotes = await git().getRemotes(true);
  const origin = remotes.find((r: { name: string }) => r.name === "origin");
  if (!origin) throw new Error("No 'origin' remote found.");

  const url = origin.refs.push || origin.refs.fetch;
  // Matches both https://github.com/owner/repo.git and git@github.com:owner/repo.git
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)(\.git)?$/);
  if (!match) throw new Error(`Cannot parse GitHub owner/repo from remote URL: ${url}`);
  return { owner: match[1], repo: match[2] };
}

function sanitizeBranchName(branchName: string): string {
  // Replace spaces with hyphens
  let sanitized = branchName.replace(/\s+/g, '-');
  
  // Replace special characters that are invalid in git branch names
  // Valid characters are: alphanumeric, hyphen, underscore, forward slash, and dot (not at start)
  sanitized = sanitized.replace(/[^a-zA-Z0-9\-_\/\.]/g, '-');
  
  // Remove leading/trailing hyphens and dots
  sanitized = sanitized.replace(/^[\-\.]+|[\-\.]+$/g, '');
  
  // Replace multiple consecutive hyphens with a single hyphen
  sanitized = sanitized.replace(/-+/g, '-');
  
  // Ensure the branch name is not empty
  if (!sanitized) {
    throw new Error('Branch name cannot be empty after sanitization');
  }
  
  return sanitized;
}

export async function createBranch(branchName: string): Promise<string> {
  if (PROTECTED_BRANCHES.has(branchName)) {
    throw new Error(`Cannot create a branch named "${branchName}" — that's a protected branch name.`);
  }
  
  const sanitized = sanitizeBranchName(branchName);
  await git().checkoutLocalBranch(sanitized);
  
  if (sanitized !== branchName) {
    return `Created and switched to branch: ${sanitized} (sanitized from "${branchName}")`;
  }
  return `Created and switched to branch: ${sanitized}`;
}

export async function getCurrentBranch(): Promise<string> {
  const status = await git().status();
  return status.current ?? "unknown";
}

export async function commitChanges(message: string): Promise<string> {
  const g = git();
  const status = await g.status();

  if (status.files.length === 0) {
    return "Nothing to commit — working tree is clean.";
  }

  // Filter out sensitive files before staging
  const safeFiles: string[] = [];
  const blockedFiles: string[] = [];
  for (const f of status.files) {
    if (SENSITIVE_PATTERNS.some((re) => re.test(f.path))) {
      blockedFiles.push(f.path);
    } else {
      safeFiles.push(f.path);
    }
  }

  if (safeFiles.length === 0) {
    return `Refused to commit — all ${blockedFiles.length} changed file(s) match sensitive patterns: ${blockedFiles.join(", ")}`;
  }

  await g.add(safeFiles);
  await g.commit(message);

  const log = await g.log({ maxCount: 1 });
  const sha = log.latest?.hash?.slice(0, 7) ?? "unknown";
  let result = `Committed ${safeFiles.length} file(s) as ${sha}: ${message}`;
  if (blockedFiles.length > 0) {
    result += `\n⚠ Skipped sensitive files: ${blockedFiles.join(", ")}`;
  }
  return result;
}

export async function pushBranch(): Promise<string> {
  const branch = await getCurrentBranch();

  if (PROTECTED_BRANCHES.has(branch)) {
    throw new Error(`Refusing to push directly to protected branch "${branch}".`);
  }

  await git().push("origin", branch, ["--set-upstream"]);
  return `Pushed branch "${branch}" to origin.`;
}

export async function openPullRequest(
  title: string,
  body: string,
  base = "main"
): Promise<string> {
  const branch = await getCurrentBranch();

  if (PROTECTED_BRANCHES.has(branch)) {
    throw new Error(`Current branch "${branch}" is protected — cannot open a PR from it.`);
  }

  const { owner, repo } = await getRemoteOwnerRepo();
  const gh = octokit();

  const { data } = await gh.pulls.create({
    owner,
    repo,
    title,
    body,
    head: branch,
    base,
  });

  return `Pull request opened: ${data.html_url}`;
}
