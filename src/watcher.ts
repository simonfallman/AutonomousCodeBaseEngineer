import chokidar, { type FSWatcher } from "chokidar";
import path from "path";
import { getRepoPath } from "./repo.js";
import { indexFile } from "./tools/search.js";
import { deleteFileChunks } from "./vectordb/pg.js";

const SKIP_DIRS = [
  "node_modules", ".git", "dist", "build", ".next",
  "__pycache__", ".venv", "venv", "target", "vendor",
];

let watcher: FSWatcher | null = null;

function repoName(repoPath: string): string {
  return path.basename(repoPath);
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
      ...SKIP_DIRS.map((d) => path.join(repoPath, d)),
    ],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  const handleChange = (filePath: string) => {
    indexFile(filePath).catch((err) =>
      console.error(`[watcher] Failed to index ${filePath}:`, err)
    );
  };

  const handleUnlink = (filePath: string) => {
    const relPath = path.relative(repoPath, filePath);
    deleteFileChunks(repoName(repoPath), relPath).catch((err) =>
      console.error(`[watcher] Failed to delete chunks for ${filePath}:`, err)
    );
  };

  watcher.on("add", handleChange);
  watcher.on("change", handleChange);
  watcher.on("unlink", handleUnlink);
  watcher.on("error", (err) =>
    console.error(`[watcher] Error:`, err)
  );
}

export async function stopWatcher(): Promise<void> {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
}
