import fs from 'node:fs/promises'
import path from 'node:path'

const HOUR_MS = 60 * 60 * 1000
/** A download untouched this long is not in progress: an active one writes every chunk. */
export const ORPHANED_MODEL_DOWNLOAD_MIN_AGE_MS = HOUR_MS

/**
 * The temporary file Transformers.js streams a model download into before it renames it into
 * place (`FileCache.put`): `<file>.tmp.<pid or Date.now()>.<random uint32 in base 36>`. An
 * interrupted download (quit, crash, sleep) leaves it behind, such as a 146 MB
 * `decoder_model_merged.onnx.tmp.76206.l1lcuz` of Whisper.
 */
const MODEL_DOWNLOAD_TEMP_NAME = /\.tmp\.(\d+)\.[0-9a-z]+$/u

export interface ModelDownloadTempFile {
  readonly name: string
  readonly modifiedAtMs: number
}

/** Whether a file under `models/` is a temporary download nothing is writing anymore. */
export function isOrphanedModelDownload(
  file: ModelDownloadTempFile,
  now: number,
  currentPid: number,
): boolean {
  const match = MODEL_DOWNLOAD_TEMP_NAME.exec(file.name)
  if (!match) return false
  // This process may still be writing it, however slowly.
  if (Number(match[1]) === currentPid) return false
  return now - file.modifiedAtMs >= ORPHANED_MODEL_DOWNLOAD_MIN_AGE_MS
}

export interface ModelDownloadSweepResult {
  readonly removedFiles: number
  readonly removedBytes: number
}

/**
 * Remove orphaned model download temporaries anywhere under `modelsRoot`. Only regular files are
 * considered and symbolic links are never followed. A missing root is an empty sweep.
 */
export async function sweepOrphanedModelDownloads(
  modelsRoot: string,
  now: number,
  currentPid: number = process.pid,
): Promise<ModelDownloadSweepResult> {
  let removedFiles = 0
  let removedBytes = 0
  const pending = [modelsRoot]
  while (true) {
    const directory = pending.pop()
    if (directory === undefined) break
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        pending.push(entryPath)
        continue
      }
      if (!entry.isFile() || !MODEL_DOWNLOAD_TEMP_NAME.test(entry.name)) continue
      const stats = await fs.lstat(entryPath).catch(() => undefined)
      if (!stats?.isFile()) continue
      if (
        !isOrphanedModelDownload({ name: entry.name, modifiedAtMs: stats.mtimeMs }, now, currentPid)
      )
        continue
      const removed = await fs.rm(entryPath).then(
        () => true,
        () => false,
      )
      if (!removed) continue
      removedFiles += 1
      removedBytes += stats.size
    }
  }
  return { removedFiles, removedBytes }
}
