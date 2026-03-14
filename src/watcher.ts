import chokidar, { type FSWatcher } from "chokidar";
import path from "path";
import { getRepoPath } from "./repo.js";
import { indexFile } from "./tools/search.js";
import { deleteFileChunks } from "./vectordb/pg.js";
import { SKIP_DIRS, repoId } from "./constants.js";

let watcher: FSWatcher | null = null;
let dbAvailable = true;
let dbCheckTimer: ReturnType<typeof setTimeout> | null = null;

/** Periodically re-check DB availability after a failure. */
function scheduleDbRecheck(): void {
  if (dbCheckTimer) return;
  dbAvailable = false;
  dbCheckTimer = setTimeout(async () => {
    dbCheckTimer = null;
    try {
      // Lightweight probe: importing pg pool and running a trivial query
      const { checkConnection } = await import("./vectordb/pg.js");
      await checkConnection();
      dbAvailable = true;
      console.error("[watcher] Database connection restored.");
    } catch {
      console.error("[watcher] Database still unavailable, will retry in 60s.");
      scheduleDbRecheck();
    }
  }, 60_000);
}

export async function restartWatcher(): Promise<void> {
  await stopWatcher();
  startWatcher();
}

export function startWatcher(): void {
  if (watcher) return;
  const repoPath = getRepoPath();

  watcher = chokidar.watch(repoPath, {
    ignored: [
      /(^|[/\\])\../,
      ...[...SKIP_DIRS].map((d) => path.join(repoPath, d)),
    ],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  const handleChange = (filePath: string) => {
    if (!dbAvailable) return; // silently skip when DB is down
    indexFile(filePath).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ECONNREFUSED") || msg.includes("connection")) {
        if (dbAvailable) {
          console.error("[watcher] Database unavailable, pausing indexing. Will retry in 60s.");
          scheduleDbRecheck();
        }
      } else {
        console.error(`[watcher] Failed to index ${filePath}:`, err);
      }
    });
  };

  const handleUnlink = (filePath: string) => {
    if (!dbAvailable) return;
    const relPath = path.relative(repoPath, filePath);
    deleteFileChunks(repoId(repoPath), relPath).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ECONNREFUSED") || msg.includes("connection")) {
        if (dbAvailable) {
          console.error("[watcher] Database unavailable, pausing chunk deletion. Will retry in 60s.");
          scheduleDbRecheck();
        }
      } else {
        console.error(`[watcher] Failed to delete chunks for ${filePath}:`, err);
      }
    });
  };

  watcher.on("add", handleChange);
  watcher.on("change", handleChange);
  watcher.on("unlink", handleUnlink);

  // Catch chokidar errors (EACCES, ENOSPC, etc.) so they don't crash the process
  watcher.on("error", (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    // EACCES on system paths like /dev — log and continue, don't crash
    if (msg.includes("EACCES") || msg.includes("EPERM")) {
      console.error(`[watcher] Permission error (non-fatal, continuing): ${msg}`);
    } else {
      console.error(`[watcher] Error:`, err);
    }
  });
}

export async function stopWatcher(): Promise<void> {
  if (dbCheckTimer) {
    clearTimeout(dbCheckTimer);
    dbCheckTimer = null;
  }
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
}
