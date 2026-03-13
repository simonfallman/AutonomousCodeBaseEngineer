import { simpleGit } from "simple-git";
import { Octokit } from "@octokit/rest";
import { getRepoPath } from "../repo.js";

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

export async function createBranch(branchName: string): Promise<string> {
  if (PROTECTED_BRANCHES.has(branchName)) {
    throw new Error(`Cannot create a branch named "${branchName}" — that's a protected branch name.`);
  }
  await git().checkoutLocalBranch(branchName);
  return `Created and switched to branch: ${branchName}`;
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

  // Stage all changes
  await g.add(".");
  await g.commit(message);

  const log = await g.log({ maxCount: 1 });
  const sha = log.latest?.hash?.slice(0, 7) ?? "unknown";
  return `Committed ${status.files.length} file(s) as ${sha}: ${message}`;
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
