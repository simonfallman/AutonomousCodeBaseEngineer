import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { setRepoPath } from "../repo.js";

vi.mock("../llm/bedrock.js", () => ({
  complete: vi.fn().mockResolvedValue("This file exports a helper function."),
}));

// Import after mock is set up
const { summarizeFile, findFunctionUsage, analyzeDependencies } = await import("../tools/intelligence.js");
const { complete } = await import("../llm/bedrock.js");

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ace-intel-test-"));
  setRepoPath(tmpDir);
  vi.clearAllMocks();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("summarizeFile", () => {
  it("calls complete and returns the result", async () => {
    await fs.writeFile(path.join(tmpDir, "util.ts"), "export function add(a: number, b: number) { return a + b; }");

    const result = await summarizeFile("util.ts");
    expect(complete).toHaveBeenCalledOnce();
    expect(result).toBe("This file exports a helper function.");
  });
});

describe("findFunctionUsage", () => {
  it("finds occurrences of a symbol across repo files", async () => {
    await fs.writeFile(
      path.join(tmpDir, "app.ts"),
      "import { authenticate } from './auth';\nauthenticate(user);"
    );
    await fs.writeFile(
      path.join(tmpDir, "middleware.ts"),
      "export function authenticate(user: string) { return true; }"
    );

    const result = await findFunctionUsage("authenticate");
    expect(result).toContain("app.ts");
    expect(result).toContain("middleware.ts");
  });

  it("returns not found message for unknown symbol", async () => {
    await fs.writeFile(path.join(tmpDir, "app.ts"), "const x = 1;");
    const result = await findFunctionUsage("nonExistentFunction");
    expect(result).toMatch(/No usages/);
  });
});

describe("analyzeDependencies", () => {
  it("parses package.json dependencies", async () => {
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: { express: "^4.0.0", lodash: "^4.0.0" },
        devDependencies: { typescript: "^5.0.0" },
      })
    );

    const result = await analyzeDependencies();
    expect(result).toContain("express");
    expect(result).toContain("lodash");
    expect(result).toContain("typescript");
  });

  it("returns message when no dependency files found", async () => {
    const result = await analyzeDependencies();
    expect(result).toMatch(/No recognized dependency files/);
  });
});
