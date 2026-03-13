import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { chunkRepository, chunkLines, LANGUAGE_MAP } from "../chunker.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ace-chunker-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("chunkLines", () => {
  it("produces a single chunk for small files", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
    const chunks = chunkLines(lines);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].start).toBe(0);
    expect(chunks[0].end).toBe(9);
  });

  it("produces overlapping chunks for large files", () => {
    const lines = Array.from({ length: 400 }, (_, i) => `line ${i}`);
    const chunks = chunkLines(lines);
    expect(chunks.length).toBeGreaterThan(1);
    // second chunk starts before first chunk ends (overlap)
    expect(chunks[1].start).toBeLessThan(chunks[0].end);
  });

  it("returns empty array for empty input", () => {
    expect(chunkLines([])).toHaveLength(0);
  });
});

describe("LANGUAGE_MAP", () => {
  it("maps .ts to typescript", () => {
    expect(LANGUAGE_MAP[".ts"]).toBe("typescript");
  });

  it("maps .py to python", () => {
    expect(LANGUAGE_MAP[".py"]).toBe("python");
  });
});

describe("chunkRepository", () => {
  it("chunks TypeScript files with correct metadata", async () => {
    await fs.writeFile(
      path.join(tmpDir, "index.ts"),
      Array.from({ length: 10 }, (_, i) => `const x${i} = ${i};`).join("\n")
    );

    const chunks = await chunkRepository(tmpDir, "test-repo");
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].repo).toBe("test-repo");
    expect(chunks[0].language).toBe("typescript");
    expect(chunks[0].filePath).toBe("index.ts");
    expect(chunks[0].startLine).toBe(1);
  });

  it("skips node_modules directory", async () => {
    await fs.mkdir(path.join(tmpDir, "node_modules", "some-pkg"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "node_modules", "some-pkg", "index.js"), "module.exports = {}");
    await fs.writeFile(path.join(tmpDir, "app.ts"), "const x = 1;");

    const chunks = await chunkRepository(tmpDir, "test-repo");
    const paths = chunks.map((c) => c.filePath);
    expect(paths.every((p) => !p.includes("node_modules"))).toBe(true);
  });

  it("skips binary extensions", async () => {
    await fs.writeFile(path.join(tmpDir, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.writeFile(path.join(tmpDir, "app.ts"), "const x = 1;");

    const chunks = await chunkRepository(tmpDir, "test-repo");
    const paths = chunks.map((c) => c.filePath);
    expect(paths).not.toContain("image.png");
    expect(paths).toContain("app.ts");
  });

  it("returns empty array for empty repo", async () => {
    const chunks = await chunkRepository(tmpDir, "empty-repo");
    expect(chunks).toHaveLength(0);
  });
});
