import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { simpleGit } from "simple-git";
import { setRepoPath } from "../repo.js";
import { getCurrentBranch, createBranch, commitChanges } from "../tools/git.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ace-git-test-"));
  setRepoPath(tmpDir);

  const git = simpleGit(tmpDir);
  await git.init();
  await git.addConfig("user.email", "test@test.com");
  await git.addConfig("user.name", "Test");

  // Create an initial commit so HEAD exists
  await fs.writeFile(path.join(tmpDir, "README.md"), "# test");
  await git.add(".");
  await git.commit("initial commit");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("getCurrentBranch", () => {
  it("returns a branch name", async () => {
    const branch = await getCurrentBranch();
    expect(typeof branch).toBe("string");
    expect(branch.length).toBeGreaterThan(0);
  });
});

describe("createBranch", () => {
  it("creates and switches to a new branch", async () => {
    await createBranch("feature/test");
    const branch = await getCurrentBranch();
    expect(branch).toBe("feature/test");
  });

  it("throws when creating a protected branch name", async () => {
    await expect(createBranch("main")).rejects.toThrow("protected");
    await expect(createBranch("master")).rejects.toThrow("protected");
    await expect(createBranch("production")).rejects.toThrow("protected");
  });
});

describe("commitChanges", () => {
  it("commits staged changes and returns the sha", async () => {
    await fs.writeFile(path.join(tmpDir, "new.ts"), "const x = 1;");
    const result = await commitChanges("add new.ts");
    expect(result).toMatch(/Committed/);
    expect(result).toContain("add new.ts");
  });

  it("returns clean message when nothing to commit", async () => {
    const result = await commitChanges("empty");
    expect(result).toMatch(/Nothing to commit/);
  });
});
