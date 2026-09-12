import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  TERMINAL_KEY_SEPARATOR,
  type TerminalKey,
  type TerminalOwnerKey,
} from '@shared/types/terminal'

const HISTORY_DIRECTORY_MODE = 0o700
const HISTORY_FILE_MODE = 0o600

export const TERMINAL_HISTORY_LOG_EXTENSION = '.log'
export const TERMINAL_HISTORY_METADATA_EXTENSION = '.meta'
export const TERMINAL_HISTORY_WORKING_DIRECTORY_EXTENSION = '.cwd'

export interface HistoryFiles {
  readonly baseName: string
  readonly logFile: string
  readonly metadataFile: string
  readonly workingDirectoryFile: string
}

export interface TerminalHistoryWorkingDirectoryEntry {
  readonly key: TerminalKey
  readonly cwd: string
  readonly files: HistoryFiles
}

export interface TerminalHistoryFiles {
  appendPrivate(file: string, content: string): Promise<void>
  describe(key: TerminalKey): HistoryFiles
  ensureDirectory(): Promise<void>
  ensureMetadata(key: TerminalKey): Promise<HistoryFiles>
  ensureWorkingDirectory(key: TerminalKey, cwd: string): Promise<HistoryFiles>
  exists(file: string): Promise<boolean>
  listOwnerEntries(ownerKey: TerminalOwnerKey): Promise<readonly string[]>
  listWorkingDirectories(): Promise<readonly TerminalHistoryWorkingDirectoryEntry[]>
  makePrivate(file: string): Promise<void>
  pathForEntry(entry: string): string
  read(file: string): Promise<string>
  readIfPresent(file: string): Promise<string | null>
  remove(files: readonly string[]): Promise<void>
  rename(from: string, to: string): Promise<void>
  writePrivate(file: string, content: string): Promise<void>
}

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('base64url')

export const ownerKeyFromTerminalKey = (key: TerminalKey) => {
  const separator = key.lastIndexOf(TERMINAL_KEY_SEPARATOR)
  return separator === -1 ? key : key.slice(0, separator)
}

export const terminalIdForOwner = (key: TerminalKey, ownerKey: TerminalOwnerKey) => {
  const prefix = `${ownerKey}${TERMINAL_KEY_SEPARATOR}`
  return key.startsWith(prefix) ? key.slice(prefix.length) : null
}

const errorCode = (error: unknown) => {
  if (!(error instanceof Error) || !('code' in error)) return undefined
  const code = Reflect.get(error, 'code')
  return typeof code === 'string' ? code : undefined
}

async function readIfPresent(file: string) {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
}

async function exists(file: string) {
  try {
    await fs.stat(file)
    return true
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false
    throw error
  }
}

const chmodPrivate = async (file: string) => {
  await fs.chmod(file, HISTORY_FILE_MODE).catch(() => undefined)
}

async function writePrivate(file: string, content: string) {
  await fs.writeFile(file, content, { encoding: 'utf8', mode: HISTORY_FILE_MODE })
  await chmodPrivate(file)
}

async function appendPrivate(file: string, content: string) {
  await fs.appendFile(file, content, { encoding: 'utf8', mode: HISTORY_FILE_MODE })
  await chmodPrivate(file)
}

export function makeTerminalHistoryFiles(logsDir: string): TerminalHistoryFiles {
  let directoryReady = false

  const describe = (key: TerminalKey): HistoryFiles => {
    const baseName = `${digest(ownerKeyFromTerminalKey(key))}.${digest(key)}`
    return {
      baseName,
      logFile: path.join(logsDir, `${baseName}${TERMINAL_HISTORY_LOG_EXTENSION}`),
      metadataFile: path.join(logsDir, `${baseName}${TERMINAL_HISTORY_METADATA_EXTENSION}`),
      workingDirectoryFile: path.join(
        logsDir,
        `${baseName}${TERMINAL_HISTORY_WORKING_DIRECTORY_EXTENSION}`,
      ),
    }
  }

  const ensureDirectory = async () => {
    if (directoryReady) return
    await fs.mkdir(logsDir, { recursive: true, mode: HISTORY_DIRECTORY_MODE })
    await fs.chmod(logsDir, HISTORY_DIRECTORY_MODE).catch(() => undefined)
    directoryReady = true
  }

  const ensureMetadata = async (key: TerminalKey) => {
    const files = describe(key)
    const metadata = await readIfPresent(files.metadataFile)
    if (metadata !== null) {
      if (metadata !== key) throw new Error('Terminal history digest collision')
      await chmodPrivate(files.metadataFile)
      return files
    }

    try {
      await fs.writeFile(files.metadataFile, key, {
        encoding: 'utf8',
        flag: 'wx',
        mode: HISTORY_FILE_MODE,
      })
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
      const racedMetadata = await readIfPresent(files.metadataFile)
      if (racedMetadata !== key) {
        throw new Error('Terminal history digest collision', { cause: error })
      }
    }
    await chmodPrivate(files.metadataFile)
    return files
  }

  const ensureWorkingDirectory = async (key: TerminalKey, cwd: string) => {
    const files = await ensureMetadata(key)
    const existing = await readIfPresent(files.workingDirectoryFile)
    if (existing !== cwd) await writePrivate(files.workingDirectoryFile, cwd)
    else await chmodPrivate(files.workingDirectoryFile)
    return files
  }

  const listDirectoryEntries = async () => {
    try {
      return await fs.readdir(logsDir)
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return []
      throw error
    }
  }

  return {
    appendPrivate,
    describe,
    ensureDirectory,
    ensureMetadata,
    ensureWorkingDirectory,
    exists,
    async listOwnerEntries(ownerKey) {
      const entries = await listDirectoryEntries()
      const prefix = `${digest(ownerKey)}.`
      return entries.filter((entry) => entry.startsWith(prefix))
    },
    async listWorkingDirectories() {
      const entries = await listDirectoryEntries()
      const workingDirectoryEntries = entries.filter((entry) =>
        entry.endsWith(TERMINAL_HISTORY_WORKING_DIRECTORY_EXTENSION),
      )
      return Promise.all(
        workingDirectoryEntries.map(async (entry) => {
          const baseName = entry.slice(0, -TERMINAL_HISTORY_WORKING_DIRECTORY_EXTENSION.length)
          const workingDirectoryFile = path.join(logsDir, entry)
          const metadataFile = path.join(
            logsDir,
            `${baseName}${TERMINAL_HISTORY_METADATA_EXTENSION}`,
          )
          const [cwd, key] = await Promise.all([
            fs.readFile(workingDirectoryFile, 'utf8'),
            fs.readFile(metadataFile, 'utf8'),
          ])
          const files = describe(key)
          if (files.baseName !== baseName)
            throw new Error('Terminal history metadata digest mismatch')
          return { key, cwd, files }
        }),
      )
    },
    makePrivate: chmodPrivate,
    pathForEntry: (entry) => path.join(logsDir, entry),
    read: (file) => fs.readFile(file, 'utf8'),
    readIfPresent,
    async remove(files) {
      await Promise.all(files.map((file) => fs.rm(file, { force: true })))
    },
    rename: (from, to) => fs.rename(from, to),
    writePrivate,
  }
}
