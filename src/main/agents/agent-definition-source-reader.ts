import type { Stats } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isPathInsideDirectory } from '../utils/project-path-validation'

export const MAX_AGENT_DEFINITION_SOURCE_BYTES = 1024 * 1024
const filesystemConstants = process.getBuiltinModule('node:fs').constants
const OPEN_READ_NO_FOLLOW =
  filesystemConstants.O_RDONLY |
  filesystemConstants.O_NONBLOCK |
  (filesystemConstants.O_NOFOLLOW ?? 0)

function sameFile(
  left: { readonly dev: number | bigint; readonly ino: number | bigint },
  right: { readonly dev: number | bigint; readonly ino: number | bigint },
) {
  return left.dev === right.dev && left.ino === right.ino
}

function isSymlinkLoop(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ELOOP'
}

function sourceCandidate(input: {
  readonly sourcePath: string
  readonly containingDirectory?: string
}) {
  if (input.containingDirectory && path.isAbsolute(input.sourcePath)) {
    throw new Error('Referenced Agent definition files must use a relative path.')
  }
  return input.containingDirectory
    ? path.resolve(input.containingDirectory, input.sourcePath)
    : path.resolve(input.sourcePath)
}

async function openSource(candidate: string, containingDirectory?: string) {
  try {
    return await fs.open(candidate, OPEN_READ_NO_FOLLOW)
  } catch (error) {
    if (containingDirectory && isSymlinkLoop(error)) {
      throw new Error('Referenced Agent definition file escapes its selected directory.', {
        cause: error,
      })
    }
    throw error
  }
}

async function canonicalSourcePath(candidate: string, containingDirectory?: string) {
  const canonical = await fs.realpath(candidate)
  if (!containingDirectory) return canonical
  const canonicalDirectory = await fs.realpath(containingDirectory)
  if (!isPathInsideDirectory(canonicalDirectory, canonical)) {
    throw new Error('Referenced Agent definition file escapes its selected directory.')
  }
  return canonical
}

async function authorizeSource(
  handle: Awaited<ReturnType<typeof fs.open>>,
  candidate: string,
  containingDirectory?: string,
) {
  const stats = await handle.stat()
  if (!stats.isFile()) throw new Error('Agent definition source must be a regular file.')
  if (stats.size > MAX_AGENT_DEFINITION_SOURCE_BYTES) {
    throw new Error('Agent definition source exceeds the 1 MiB size limit.')
  }
  const canonical = await canonicalSourcePath(candidate, containingDirectory)
  const linkedStats = await fs.stat(canonical)
  if (!sameFile(stats, linkedStats)) {
    throw new Error('Agent definition source changed while it was being authorized.')
  }
  return { canonical, stats }
}

async function readCappedSource(handle: Awaited<ReturnType<typeof fs.open>>) {
  const bytes = Buffer.allocUnsafe(MAX_AGENT_DEFINITION_SOURCE_BYTES + 1)
  let bytesRead = 0
  while (bytesRead < bytes.byteLength) {
    const result = await handle.read(bytes, bytesRead, bytes.byteLength - bytesRead, bytesRead)
    if (result.bytesRead === 0) break
    bytesRead += result.bytesRead
  }
  return { bytes, bytesRead }
}

function verifySourceUnchanged(initialStats: Stats, finalStats: Stats, bytesRead: number) {
  if (
    bytesRead > MAX_AGENT_DEFINITION_SOURCE_BYTES ||
    finalStats.size > MAX_AGENT_DEFINITION_SOURCE_BYTES
  ) {
    throw new Error('Agent definition source exceeds the 1 MiB size limit.')
  }
  if (
    !sameFile(initialStats, finalStats) ||
    bytesRead !== initialStats.size ||
    finalStats.size !== initialStats.size
  ) {
    throw new Error('Agent definition source changed while it was being read.')
  }
}

export async function readBoundedAgentDefinitionSource(input: {
  readonly sourcePath: string
  readonly containingDirectory?: string
  /** Test seam for proving that reads remain bound after pathname validation. */
  readonly beforeRead?: () => Promise<void>
}) {
  const candidate = sourceCandidate(input)
  const handle = await openSource(candidate, input.containingDirectory)
  try {
    const authorized = await authorizeSource(handle, candidate, input.containingDirectory)
    await input.beforeRead?.()
    const { bytes, bytesRead } = await readCappedSource(handle)
    const finalStats = await handle.stat()
    verifySourceUnchanged(authorized.stats, finalStats, bytesRead)
    return {
      sourcePath: authorized.canonical,
      content: bytes.subarray(0, bytesRead).toString('utf8'),
    }
  } finally {
    await handle.close()
  }
}
