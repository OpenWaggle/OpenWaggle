import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { mcpFileWriteTargetAsync } from '../config/mcp-file-write-target'

/** The file operations the migration needs; injectable for tests. */
export interface McpMigrationFs {
  /** The file's text, or undefined when it does not exist. */
  readText(filePath: string): Promise<string | undefined>
  /** Replace the file through a temporary file and rename, creating directories. */
  writeTextAtomic(filePath: string, content: string): Promise<void>
  /** Create the file only if it does not exist. Returns false when it already existed. */
  createTextExclusive(filePath: string, content: string): Promise<boolean>
}

/** MCP files can hold credentials: a file the migration creates is readable by the user only. */
const NEW_FILE_MODE = 0o600
const PRIVATE_DIRECTORY_MODE = 0o700
const PERMISSION_BITS = 0o777

function errorCode(error: unknown) {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

export const nodeMcpMigrationFs: McpMigrationFs = {
  async readText(filePath) {
    try {
      return await readFile(filePath, 'utf8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return undefined
      throw error
    }
  },
  async writeTextAtomic(linkOrFile, content) {
    // A symbolic link stays a link: the file it points to is replaced.
    const filePath = await mcpFileWriteTargetAsync(linkOrFile)
    await mkdir(path.dirname(filePath), { recursive: true })
    const tempPath = `${filePath}.${randomUUID()}.tmp`
    // The rewritten file keeps the mode it had; the rename would otherwise give it the default.
    const mode = await stat(filePath).then(
      (stats) => stats.mode & PERMISSION_BITS,
      () => NEW_FILE_MODE,
    )
    try {
      await writeFile(tempPath, content, { encoding: 'utf8', mode })
      await chmod(tempPath, mode)
      await rename(tempPath, filePath)
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined)
      throw error
    }
  },
  async createTextExclusive(filePath, content) {
    // Backups of project files are kept in the user's OpenWaggle data, private like the files.
    await mkdir(path.dirname(filePath), { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
    try {
      await writeFile(filePath, content, { encoding: 'utf8', flag: 'wx', mode: NEW_FILE_MODE })
      return true
    } catch (error) {
      if (errorCode(error) === 'EEXIST') return false
      throw error
    }
  },
}
