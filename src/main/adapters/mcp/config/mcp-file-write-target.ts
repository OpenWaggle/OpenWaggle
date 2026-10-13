import { lstatSync, readlinkSync, realpathSync } from 'node:fs'
import { lstat, readlink, realpath } from 'node:fs/promises'
import path from 'node:path'

/**
 * The file a write to `filePath` must replace. MCP files are often symbolic links into a dotfiles
 * repository; renaming a temporary file over the link would turn it into a regular file, so writes
 * go to the file the link points to (also when that file does not exist yet), with the temporary
 * file next to it.
 */
export function mcpFileWriteTarget(filePath: string): string {
  try {
    return realpathSync(filePath)
  } catch {
    try {
      if (!lstatSync(filePath).isSymbolicLink()) return filePath
      return path.resolve(path.dirname(filePath), readlinkSync(filePath))
    } catch {
      return filePath
    }
  }
}

/** `mcpFileWriteTarget` for async callers. */
export async function mcpFileWriteTargetAsync(filePath: string): Promise<string> {
  try {
    return await realpath(filePath)
  } catch {
    try {
      if (!(await lstat(filePath)).isSymbolicLink()) return filePath
      return path.resolve(path.dirname(filePath), await readlink(filePath))
    } catch {
      return filePath
    }
  }
}
