import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { simpleGit } from "simple-git";
import { setRepoPath } from "../repo.js";
import {
  listFiles,
  readFile,
  writeFile,
  deleteFile,
  searchFiles,
  grepRepo,
  applyPatch,
  resolveSafe,
} from "../tools/navigation.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ace-nav-test-"));
  await simpleGit(tmpDir).init();
  setRepoPath(tmpDir);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("listFiles", () => {
  it("lists files and marks directories", async () => {
    await fs.writeFile(path.join(tmpDir, "foo.ts"), "");
    await fs.mkdir(path.join(tmpDir, "subdir"));
    const result = await listFiles(".");
    expect(result).toContain("foo.ts");
    expect(result).toContain("subdir/");
  });
});

describe("readFile / writeFile", () => {
  it("round-trips content", async () => {
    await writeFile("hello.txt", "world");
    const content = await readFile("hello.txt");
    expect(content).toBe("world");
  });

  it("creates parent directories", async () => {
    await writeFile("a/b/c.txt", "nested");
    const content = await readFile("a/b/c.txt");
    expect(content).toBe("nested");
  });
});

describe("resolveSafe", () => {
  it("throws on path traversal", () => {
    expect(() => resolveSafe("../../etc/passwd")).toThrow("Path escapes repo root");
  });

  it("allows nested paths", () => {
    const result = resolveSafe("src/foo.ts");
    expect(result).toBe(path.join(tmpDir, "src/foo.ts"));
  });
});

describe("deleteFile", () => {
  it("deletes an existing file", async () => {
    await writeFile("todelete.txt", "bye");
    const result = await deleteFile("todelete.txt");
    expect(result).toContain("Deleted");
    await expect(readFile("todelete.txt")).rejects.toThrow();
  });

  it("throws on path traversal", () => {
    expect(() => resolveSafe("../../etc/passwd")).toThrow("Path escapes repo root");
  });
});

describe("searchFiles", () => {
  it("finds files by glob pattern", async () => {
    await fs.mkdir(path.join(tmpDir, "src"));
    await fs.writeFile(path.join(tmpDir, "src", "index.ts"), "");
    await fs.writeFile(path.join(tmpDir, "src", "utils.ts"), "");
    await fs.writeFile(path.join(tmpDir, "README.md"), "");

    const result = await searchFiles("**/*.ts");
    expect(result).toContain("src/index.ts");
    expect(result).toContain("src/utils.ts");
    expect(result).not.toContain("README.md");
  });

  it("returns no-match message when nothing found", async () => {
    const result = await searchFiles("**/*.go");
    expect(result).toMatch(/No files matched/);
  });
});

describe("grepRepo", () => {
  it("finds pattern matches with file:line format", async () => {
    await fs.writeFile(path.join(tmpDir, "app.ts"), "export function hello() {}\nexport function world() {}");

    const result = await grepRepo("export function");
    expect(result).toContain("app.ts:1:");
    expect(result).toContain("app.ts:2:");
  });

  it("returns no-match message when nothing found", async () => {
    await fs.writeFile(path.join(tmpDir, "app.ts"), "const x = 1;");
    const result = await grepRepo("import React");
    expect(result).toMatch(/No matches/);
  });

  it("returns an error message for invalid regex", async () => {
    const result = await grepRepo("[invalid(");
    expect(result).toMatch(/Invalid regex/);
  });

  it("narrows search to a subdirectory", async () => {
    await fs.mkdir(path.join(tmpDir, "lib"));
    await fs.writeFile(path.join(tmpDir, "root.ts"), "needle");
    await fs.writeFile(path.join(tmpDir, "lib", "lib.ts"), "needle");

    const result = await grepRepo("needle", "lib");
    expect(result).toContain("lib/lib.ts");
    expect(result).not.toContain("root.ts");
  });
});

describe("applyPatch", () => {
  it("applies a valid unified diff", async () => {
    await writeFile("target.txt", "line1\nline2\nline3\n");

    const diff = [
      "--- target.txt",
      "+++ target.txt",
      "@@ -1,3 +1,3 @@",
      " line1",
      "-line2",
      "+LINE2",
      " line3",
    ].join("\n") + "\n";

    const result = await applyPatch("target.txt", diff);
    expect(result).toContain("Patch applied");

    const content = await readFile("target.txt");
    expect(content).toContain("LINE2");
    expect(content).not.toContain("line2");
  });

  it("throws on an invalid patch", async () => {
    await writeFile("target.txt", "hello\n");
    const badDiff = "--- a/target.txt\n+++ b/target.txt\n@@ -99,1 +99,1 @@\n-missing\n+replaced\n";
    await expect(applyPatch("target.txt", badDiff)).rejects.toThrow("Patch failed");
  });
});
