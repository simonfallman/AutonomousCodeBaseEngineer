import pg from "pg";
import pgvector from "pgvector/pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
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

export async function upsertChunks(chunks: Chunk[], embeddings: number[][]): Promise<void> {
  const db = getPool();
  // Clear existing chunks for this repo+file before re-inserting
  if (chunks.length === 0) return;
  const { repo, filePath } = chunks[0];
  await db.query("DELETE FROM code_chunks WHERE repo = $1 AND file_path = $2", [repo, filePath]);

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    await db.query(
      `INSERT INTO code_chunks (repo, file_path, start_line, end_line, language, content, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [c.repo, c.filePath, c.startLine, c.endLine, c.language, c.content, pgvector.toSql(embeddings[i])]
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
