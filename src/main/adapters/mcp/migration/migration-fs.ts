import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
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
    try {
      await writeFile(tempPath, content, 'utf8')
      await rename(tempPath, filePath)
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined)
      throw error
    }
  },
  async createTextExclusive(filePath, content) {
    await mkdir(path.dirname(filePath), { recursive: true })
    try {
      await writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' })
      return true
    } catch (error) {
      if (errorCode(error) === 'EEXIST') return false
      throw error
    }
  },
}
