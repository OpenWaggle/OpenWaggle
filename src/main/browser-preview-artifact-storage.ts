import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { BROWSER_PREVIEW_CAPTURE_LIMITS } from '@shared/types/browser-preview-controls'

const ARTIFACT_DIRECTORY_MODE = 0o700
const ARTIFACT_FILE_MODE = 0o600
const ARTIFACT_FILENAME = /^browser-(?:screenshot|recording)-[a-z0-9-]+\.(?:png|webm|mp4)$/u
const TEMP_ARTIFACT_FILENAME = /^\.browser-artifact-[a-f0-9-]+\.tmp$/u

interface ArtifactStorageLimits {
  readonly maxFiles: number
  readonly maxTotalBytes: number
}

interface StoredArtifactEntry {
  readonly name: string
  readonly path: string
  readonly size: number
  readonly mtimeMs: number
}

export class BrowserPreviewArtifactStorage {
  private mutationTail: Promise<void> = Promise.resolve()

  constructor(
    readonly directory: string,
    private readonly limits: ArtifactStorageLimits = {
      maxFiles: BROWSER_PREVIEW_CAPTURE_LIMITS.ARTIFACT_FILES,
      maxTotalBytes: BROWSER_PREVIEW_CAPTURE_LIMITS.ARTIFACT_TOTAL_BYTES,
    },
  ) {}

  write(kind: 'screenshot' | 'recording', extension: 'png' | 'webm' | 'mp4', data: Uint8Array) {
    return this.serialize(async () => {
      await this.ensureDirectory()
      const id = randomUUID()
      const finalName = `browser-${kind}-${id}.${extension}`
      const finalPath = path.join(this.directory, finalName)
      const temporaryPath = path.join(this.directory, `.browser-artifact-${id}.tmp`)
      try {
        await fs.writeFile(temporaryPath, data, {
          flag: 'wx',
          mode: ARTIFACT_FILE_MODE,
        })
        await fs.rename(temporaryPath, finalPath)
      } catch (error) {
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
        throw error
      }
      await this.prune()
      return { id, path: finalPath }
    })
  }

  async resolveOwnedArtifact(candidatePath: string): Promise<string> {
    await this.ensureDirectory()
    const resolvedDirectory = await fs.realpath(this.directory)
    const resolvedCandidate = path.resolve(candidatePath)
    if (
      path.dirname(resolvedCandidate) !== path.resolve(this.directory) ||
      !ARTIFACT_FILENAME.test(path.basename(resolvedCandidate))
    ) {
      throw new Error('Browser preview artifact is outside the managed artifact directory.')
    }
    const candidateStat = await fs.lstat(resolvedCandidate)
    if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) {
      throw new Error('Browser preview artifact must be a regular file.')
    }
    const canonicalCandidate = await fs.realpath(resolvedCandidate)
    if (path.dirname(canonicalCandidate) !== resolvedDirectory) {
      throw new Error('Browser preview artifact resolved outside the managed artifact directory.')
    }
    return canonicalCandidate
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation)
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async ensureDirectory() {
    await fs.mkdir(this.directory, { recursive: true, mode: ARTIFACT_DIRECTORY_MODE })
    const stat = await fs.lstat(this.directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Browser preview artifact directory must be a real directory.')
    }
    await fs.chmod(this.directory, ARTIFACT_DIRECTORY_MODE)
  }

  private async prune() {
    const directoryEntries = await fs.readdir(this.directory, { withFileTypes: true })
    const files: StoredArtifactEntry[] = []
    for (const entry of directoryEntries) {
      const entryPath = path.join(this.directory, entry.name)
      if (TEMP_ARTIFACT_FILENAME.test(entry.name)) {
        await fs.rm(entryPath, { force: true })
        continue
      }
      if (!entry.isFile() || !ARTIFACT_FILENAME.test(entry.name)) continue
      const stat = await fs.lstat(entryPath)
      if (!stat.isFile() || stat.isSymbolicLink()) continue
      files.push({ name: entry.name, path: entryPath, size: stat.size, mtimeMs: stat.mtimeMs })
    }

    files.sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name))
    let retainedBytes = 0
    for (const [index, entry] of files.entries()) {
      retainedBytes += entry.size
      if (index < this.limits.maxFiles && retainedBytes <= this.limits.maxTotalBytes) continue
      await fs.rm(entry.path, { force: true })
    }
  }
}
