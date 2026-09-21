import { open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { decodeUnknownOrThrow } from '@shared/schema'
import { actionRelativePathSchema } from '@shared/schemas/action-definitions'
import { ACTION_DEFINITION_LIMITS } from '@shared/types/action-definitions'
import { isEnoent } from '@shared/utils/node-error'

export async function resolveActionPath(workspace: string, directory: string): Promise<string> {
  decodeUnknownOrThrow(actionRelativePathSchema, directory)
  const root = await realpath(workspace)
  const target = await realpath(resolve(root, directory))
  const relativePath = relative(root, target)
  if (
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    relativePath.startsWith('..\\') ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Action path escapes the workspace: ${directory}`)
  }
  return target
}

export async function resolveActionDirectory(
  workspace: string,
  directory: string,
): Promise<string> {
  const target = await resolveActionPath(workspace, directory)
  if (!(await stat(target)).isDirectory())
    throw new Error(`Action working directory is not a directory: ${directory}`)
  return target
}

/** No subprocesses, module imports or dependency installs during discovery. */
export async function readTaskSource(workspace: string, source: string): Promise<string | null> {
  let path: string
  try {
    path = await resolveActionPath(workspace, source)
  } catch (error) {
    if (isEnoent(error)) return null
    throw error
  }
  const handle = await open(path, 'r')
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile()) throw new Error(`${source} is not a regular file.`)
    if (metadata.size > ACTION_DEFINITION_LIMITS.FILE_BYTES)
      throw new Error(`${source} exceeds the task discovery size limit.`)
    const buffer = Buffer.alloc(ACTION_DEFINITION_LIMITS.FILE_BYTES + 1)
    let bytesRead = 0
    while (bytesRead < buffer.length) {
      const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead)
      if (chunk.bytesRead === 0) break
      bytesRead += chunk.bytesRead
    }
    if (bytesRead > ACTION_DEFINITION_LIMITS.FILE_BYTES)
      throw new Error(`${source} exceeds the task discovery size limit.`)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}
