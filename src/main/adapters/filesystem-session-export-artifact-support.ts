import { createHash, randomUUID } from 'node:crypto'
import { type FileHandle, open, stat, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionExportArtifactError } from '../errors'
import type { SessionExportOperationRecord } from '../ports/session-export-operation-repository'
import { assertFilesystemWriteScope } from '../utils/filesystem-write-scope'
import {
  installArtifactDescriptorInBoundDirectory,
  installArtifactInBoundDirectory,
  sameFilesystemEntry,
} from './filesystem-session-export-bound-installer'

const filesystemConstants = process.getBuiltinModule('node:fs').constants
const OPEN_READ_NO_FOLLOW = filesystemConstants.O_RDONLY | (filesystemConstants.O_NOFOLLOW ?? 0)
const OPEN_READ_WRITE_NEW_NO_FOLLOW =
  filesystemConstants.O_RDWR |
  filesystemConstants.O_CREAT |
  filesystemConstants.O_EXCL |
  (filesystemConstants.O_NOFOLLOW ?? 0)
const OWNER_FILE_MODE = 0o600
const COPY_BUFFER_BYTES = 1024 * 1024

export async function pathExists(filePath: string) {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

export async function openUnlinkedScopedExportFile(label: string) {
  const temporaryPath = path.join(
    os.tmpdir(),
    `.openwaggle-export-${label}-${randomUUID()}.pending`,
  )
  const handle = await open(temporaryPath, OPEN_READ_WRITE_NEW_NO_FOLLOW, OWNER_FILE_MODE)
  try {
    await unlink(temporaryPath)
    return handle
  } catch (error) {
    await handle.close().catch(() => undefined)
    throw error
  }
}

export function sessionExportArtifactError(operation: string, cause: unknown) {
  return new SessionExportArtifactError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  })
}

export function openNewExportArtifact(filePath: string) {
  return open(filePath, OPEN_READ_WRITE_NEW_NO_FOLLOW, OWNER_FILE_MODE)
}

async function syncParent(filePath: string) {
  try {
    const handle = await open(path.dirname(filePath), OPEN_READ_NO_FOLLOW)
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch {
    // Some platforms do not support syncing directory handles.
  }
}

export async function assertOperationPathScope(
  operation: SessionExportOperationRecord,
  candidatePath: string,
) {
  if (!operation.destinationRoot) return
  const scope = await assertFilesystemWriteScope({
    roots: [operation.destinationRoot],
    destinationPath: candidatePath,
  })
  if (
    path.resolve(scope.rootPath) !== path.resolve(operation.destinationRoot) ||
    path.resolve(scope.destinationPath) !== path.resolve(candidatePath)
  ) {
    throw new Error('The export destination no longer matches its authorized filesystem scope.')
  }
}

export async function installExportArtifact(
  operation: SessionExportOperationRecord,
  expectedArtifact: { readonly dev: number | bigint; readonly ino: number | bigint },
  scopedSourceHandle?: FileHandle,
) {
  await assertOperationPathScope(operation, operation.destinationPath)
  if (operation.destinationRoot) {
    if (!scopedSourceHandle) {
      throw new Error('Scoped export installation requires its open staging descriptor.')
    }
    const sourceStats = await scopedSourceHandle.stat({ bigint: true })
    if (!sourceStats.isFile() || !sameFilesystemEntry(sourceStats, expectedArtifact)) {
      throw new Error('The staged export artifact changed before installation.')
    }
    await installArtifactDescriptorInBoundDirectory({
      sourceHandle: scopedSourceHandle,
      sourceDigest: await digestFileHandle(scopedSourceHandle),
      destinationPath: operation.destinationPath,
      destinationRoot: operation.destinationRoot,
      overwriteExisting: operation.overwriteExisting,
    })
    await assertOperationPathScope(operation, operation.destinationPath)
    await syncParent(operation.destinationPath)
    return
  }
  const sourceHandle = await open(operation.temporaryPath, OPEN_READ_NO_FOLLOW)
  try {
    const sourceStats = await sourceHandle.stat({ bigint: true })
    if (!sourceStats.isFile() || !sameFilesystemEntry(sourceStats, expectedArtifact)) {
      throw new Error('The staged export artifact changed before installation.')
    }
  } finally {
    await sourceHandle.close()
  }
  await installArtifactInBoundDirectory({
    sourcePath: operation.temporaryPath,
    destinationPath: operation.destinationPath,
    ...(operation.destinationRoot ? { destinationRoot: operation.destinationRoot } : {}),
    overwriteExisting: operation.overwriteExisting,
    expectedArtifact,
  })
  const destinationHandle = await open(operation.destinationPath, OPEN_READ_NO_FOLLOW)
  try {
    const installedStats = await destinationHandle.stat()
    if (!installedStats.isFile() || !sameFilesystemEntry(installedStats, expectedArtifact)) {
      throw new Error('The installed export artifact does not match the staged artifact.')
    }
  } finally {
    await destinationHandle.close()
  }
  await assertOperationPathScope(operation, operation.destinationPath)
  await syncParent(operation.destinationPath)
}

export async function digestFileHandle(handle: FileHandle) {
  const digest = createHash('sha256')
  const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES)
  let position = 0
  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
    if (bytesRead === 0) return digest.digest('hex')
    digest.update(buffer.subarray(0, bytesRead))
    position += bytesRead
  }
}

export async function verifyInstalledExportArtifact(
  operation: SessionExportOperationRecord,
  receipt: { readonly sha256: string; readonly sizeBytes: number },
) {
  await assertOperationPathScope(operation, operation.destinationPath)
  try {
    const handle = await open(operation.destinationPath, OPEN_READ_NO_FOLLOW)
    try {
      const stats = await handle.stat()
      if (!stats.isFile() || stats.size !== receipt.sizeBytes) return false
      return (await digestFileHandle(handle)) === receipt.sha256
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

export function normalizeResourcePath(resourcePath: string) {
  const slashPath = resourcePath.replaceAll('\\', '/').trim()
  if (!slashPath || path.posix.isAbsolute(slashPath)) {
    throw new Error('Export resource path must be relative.')
  }
  const normalized = path.posix.normalize(slashPath)
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Export resource path cannot leave the bundle.')
  }
  return normalized.replace(/^\.\//, '')
}

export async function copyFileHandles(source: FileHandle, destination: FileHandle) {
  const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES)
  let readPosition = 0
  let writePosition = 0
  while (true) {
    const { bytesRead } = await source.read(buffer, 0, buffer.length, readPosition)
    if (bytesRead === 0) return writePosition
    readPosition += bytesRead
    let writtenFromChunk = 0
    while (writtenFromChunk < bytesRead) {
      const { bytesWritten } = await destination.write(
        buffer,
        writtenFromChunk,
        bytesRead - writtenFromChunk,
        writePosition,
      )
      if (bytesWritten === 0) throw new Error('Export resource write made no progress.')
      writtenFromChunk += bytesWritten
      writePosition += bytesWritten
    }
  }
}
