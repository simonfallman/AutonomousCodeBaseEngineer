import pg from "pg";
import pgvector from "pgvector/pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on("connect", (client) => pgvector.registerTypes(client));
  }
  return pool;
}

export async function setupSchema(): Promise<void> {
  const db = getPool();
  await db.query("CREATE EXTENSION IF NOT EXISTS vector");
  await db.query(`
    CREATE TABLE IF NOT EXISTS code_chunks (
      id        SERIAL PRIMARY KEY,
      repo      TEXT NOT NULL,
      file_path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line   INTEGER NOT NULL,
      language  TEXT,
      content   TEXT NOT NULL,
      embedding vector(1024)
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS code_chunks_embedding_idx
    ON code_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100)
  `);
}

export interface Chunk {
  repo: string;
  filePath: string;
  startLine: number;
  endLine: number;
  language: string | null;
  content: string;
}

const INSERT_BATCH_SIZE = 50;

export async function upsertChunks(chunks: Chunk[], embeddings: number[][]): Promise<void> {
  const db = getPool();
  if (chunks.length === 0) return;

  const { repo, filePath } = chunks[0];
  await db.query("DELETE FROM code_chunks WHERE repo = $1 AND file_path = $2", [repo, filePath]);

  // Batch insert instead of individual inserts
  for (let i = 0; i < chunks.length; i += INSERT_BATCH_SIZE) {
    const batch = chunks.slice(i, i + INSERT_BATCH_SIZE);
    const batchEmbeddings = embeddings.slice(i, i + INSERT_BATCH_SIZE);

    const values: unknown[] = [];
    const placeholders: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      const c = batch[j];
      const offset = j * 7;
      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`);
      values.push(c.repo, c.filePath, c.startLine, c.endLine, c.language, c.content, pgvector.toSql(batchEmbeddings[j]));
    }

    await db.query(
      `INSERT INTO code_chunks (repo, file_path, start_line, end_line, language, content, embedding)
       VALUES ${placeholders.join(", ")}`,
      values
    );
  }
}

export interface SearchResult {
  filePath: string;
  startLine: number;
  endLine: number;
  language: string | null;
  content: string;
  score: number;
}

export async function similaritySearch(
  repo: string,
  queryEmbedding: number[],
  limit = 5
): Promise<SearchResult[]> {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT file_path, start_line, end_line, language, content,
            1 - (embedding <=> $1) AS score
     FROM code_chunks
     WHERE repo = $2
     ORDER BY embedding <=> $1
     LIMIT $3`,
    [pgvector.toSql(queryEmbedding), repo, limit]
  );
  return rows.map((r) => ({
    filePath: r.file_path,
    startLine: r.start_line,
    endLine: r.end_line,
    language: r.language,
    content: r.content,
    score: parseFloat(r.score),
  }));
}

export async function deleteFileChunks(repo: string, filePath: string): Promise<void> {
  const db = getPool();
  await db.query("DELETE FROM code_chunks WHERE repo = $1 AND file_path = $2", [repo, filePath]);
}
