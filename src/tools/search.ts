import fs from "fs/promises";
import path from "path";
import { getRepoPath } from "../repo.js";
import { embed } from "../embeddings/bedrock.js";
import { setupSchema, upsertChunks, similaritySearch } from "../vectordb/pg.js";
import { chunkRepository, chunkLines, LANGUAGE_MAP } from "../chunker.js";
import type { Chunk } from "../vectordb/pg.js";

function repoName(repoPath: string): string {
  return path.basename(repoPath);
}

export async function indexRepository(
  onProgress?: (message: string) => void
): Promise<string> {
  const repoPath = getRepoPath();
  const name = repoName(repoPath);

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
  const name = repoName(repoPath);
  const relPath = path.relative(repoPath, absFilePath);
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
  const name = repoName(repoPath);

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
