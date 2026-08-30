import fs from 'node:fs/promises'
import path from 'node:path'
import { isPathInsideDirectory } from '../utils/project-path-validation'

export const MAX_AGENT_DEFINITION_SOURCE_BYTES = 1024 * 1024
const filesystemConstants = process.getBuiltinModule('node:fs').constants
const OPEN_READ_NO_FOLLOW = filesystemConstants.O_RDONLY | (filesystemConstants.O_NOFOLLOW ?? 0)

function sameFile(
  left: { readonly dev: number | bigint; readonly ino: number | bigint },
  right: { readonly dev: number | bigint; readonly ino: number | bigint },
) {
  return left.dev === right.dev && left.ino === right.ino
}

export async function readBoundedAgentDefinitionSource(input: {
  readonly sourcePath: string
  readonly containingDirectory?: string
  /** Test seam for proving that reads remain bound after pathname validation. */
  readonly beforeRead?: () => Promise<void>
}) {
  if (input.containingDirectory && path.isAbsolute(input.sourcePath)) {
    throw new Error('Referenced Agent definition files must use a relative path.')
  }
  const candidate = input.containingDirectory
    ? path.resolve(input.containingDirectory, input.sourcePath)
    : path.resolve(input.sourcePath)
  let handle: Awaited<ReturnType<typeof fs.open>>
  try {
    handle = await fs.open(candidate, OPEN_READ_NO_FOLLOW)
  } catch (error) {
    if (
      input.containingDirectory &&
      error instanceof Error &&
      'code' in error &&
      error.code === 'ELOOP'
    ) {
      throw new Error('Referenced Agent definition file escapes its selected directory.', {
        cause: error,
      })
    }
    throw error
  }
  try {
    const stats = await handle.stat()
    if (!stats.isFile()) throw new Error('Agent definition source must be a regular file.')
    if (stats.size > MAX_AGENT_DEFINITION_SOURCE_BYTES) {
      throw new Error('Agent definition source exceeds the 1 MiB size limit.')
    }
    const canonical = await fs.realpath(candidate)
    if (input.containingDirectory) {
      const canonicalDirectory = await fs.realpath(input.containingDirectory)
      if (!isPathInsideDirectory(canonicalDirectory, canonical)) {
        throw new Error('Referenced Agent definition file escapes its selected directory.')
      }
    }
    const linkedStats = await fs.stat(canonical)
    if (!sameFile(stats, linkedStats)) {
      throw new Error('Agent definition source changed while it was being authorized.')
    }
    await input.beforeRead?.()
    return { sourcePath: canonical, content: await handle.readFile('utf8') }
  } finally {
    await handle.close()
  }
}
