import fs from "fs/promises";
import path from "path";
import { getRepoPath } from "../repo.js";
import { embed } from "../embeddings/bedrock.js";
import { setupSchema, upsertChunks, similaritySearch } from "../vectordb/pg.js";
import { chunkRepository, chunkLines, LANGUAGE_MAP } from "../chunker.js";
import type { Chunk } from "../vectordb/pg.js";
import { repoId, MAX_FILE_SIZE } from "../constants.js";

export async function indexRepository(
  onProgress?: (message: string) => void
): Promise<string> {
  const repoPath = getRepoPath();
  const name = repoId(repoPath);

  onProgress?.("Setting up schema...");
  await setupSchema();

  onProgress?.("Scanning and chunking files...");
  const chunks = await chunkRepository(repoPath, name);
  if (chunks.length === 0) return "No indexable files found.";

  const BATCH = 20;
  let indexed = 0;

  const byFile = new Map<string, typeof chunks>();
  for (const chunk of chunks) {
    const key = chunk.filePath;
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key)!.push(chunk);
  }

  const totalFiles = byFile.size;
  let filesDone = 0;

  for (const [filePath, fileChunks] of byFile) {
    filesDone++;

    // Skip files larger than 1MB to avoid slow embedding calls
    const absFilePath = path.join(repoPath, filePath);
    const stats = await fs.stat(absFilePath).catch(() => null);
    if (stats && stats.size > MAX_FILE_SIZE) {
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      onProgress?.(`[${filesDone}/${totalFiles}] Skipping ${filePath} (${sizeMB}MB — too large)`);
      continue;
    }

    onProgress?.(`[${filesDone}/${totalFiles}] Embedding ${filePath}`);

    const embeddings: number[][] = [];
    for (let i = 0; i < fileChunks.length; i += BATCH) {
      const batch = fileChunks.slice(i, i + BATCH);
      const batchEmbeddings = await Promise.all(batch.map((c) => embed(c.content)));
      embeddings.push(...batchEmbeddings);
    }
    await upsertChunks(fileChunks, embeddings);
    indexed += fileChunks.length;
  }

  return `Indexed ${indexed} chunks across ${totalFiles} files in repo "${name}".`;
}

export async function indexFile(absFilePath: string): Promise<void> {
  const repoPath = getRepoPath();
  const name = repoId(repoPath);
  const relPath = path.relative(repoPath, absFilePath);

  // Skip files larger than 1MB to avoid slow embedding calls
  const stats = await fs.stat(absFilePath);
  if (stats.size > MAX_FILE_SIZE) {
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.error(`[search] Skipping "${relPath}" — file too large (${sizeMB}MB, max 1MB)`);
    return;
  }

  const ext = path.extname(absFilePath).toLowerCase();
  const language = LANGUAGE_MAP[ext] ?? null;

  const content = await fs.readFile(absFilePath, "utf-8");
  const rawChunks = chunkLines(content.split("\n"));
  const chunks: Chunk[] = rawChunks.map((c) => ({
    repo: name,
    filePath: relPath,
    startLine: c.start + 1,
    endLine: c.end + 1,
    language,
    content: c.text,
  }));

  const BATCH = 20;
  const embeddings: number[][] = [];
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const batchEmbeddings = await Promise.all(batch.map((c) => embed(c.content)));
    embeddings.push(...batchEmbeddings);
  }
  await upsertChunks(chunks, embeddings);
}

export async function semanticSearch(query: string, limit = 5): Promise<string> {
  const repoPath = getRepoPath();
  const name = repoId(repoPath);

  const queryEmbedding = await embed(query);
  const results = await similaritySearch(name, queryEmbedding, limit);

  if (results.length === 0) {
    return `No results found. Run index_repository first.`;
  }

  return results
    .map(
      (r, i) =>
        `## Result ${i + 1} — ${r.filePath}:${r.startLine}-${r.endLine} (score: ${r.score.toFixed(3)})\n\`\`\`${r.language ?? ""}\n${r.content}\n\`\`\``
    )
    .join("\n\n");
}
