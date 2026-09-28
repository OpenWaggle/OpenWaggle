import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { isEnoent } from '@shared/utils/node-error'
import { createLogger } from '../../../logger'
import { withProcessFileLock } from '../process-file-lock'
import type { McpRuntimeTool } from './types'

const logger = createLogger('mcp-tool-catalog-cache')

const FILE_VERSION = 1
const DIRECTORY_MODE = 0o700
const FILE_MODE = 0o600
/** Room for every entry at its size limit, plus one more for the JSON around them. */
const MAX_FILE_BYTES =
  (MCP_CONFIG.TOOL_CATALOG_MAX_ENTRIES + 1) * MCP_CONFIG.TOOL_CATALOG_MAX_ENTRY_BYTES

export interface SealedEntry {
  readonly updatedAt: number
  /** Which server the entry belongs to, hashed, so it can be forgotten without being opened. */
  readonly server: string
  readonly sealed: string
}

export type SealedEntries = Readonly<Record<string, SealedEntry>>

interface CacheFile {
  readonly entries: SealedEntries
  /** False for a file a newer OpenWaggle wrote: it is read as empty and never overwritten. */
  readonly writable: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isSealedEntry(value: unknown): value is SealedEntry {
  return (
    isRecord(value) &&
    typeof value.updatedAt === 'number' &&
    typeof value.server === 'string' &&
    typeof value.sealed === 'string'
  )
}

function isRuntimeTool(value: unknown): value is McpRuntimeTool {
  if (!isRecord(value) || typeof value.name !== 'string') return false
  return (
    (value.title === undefined || typeof value.title === 'string') &&
    (value.description === undefined || typeof value.description === 'string') &&
    (value.inputSchema === undefined || isRecord(value.inputSchema))
  )
}

export function serverTag(serverInstanceId: string) {
  return createHash('sha256').update(`mcp-tool-catalog-server\0${serverInstanceId}`).digest('hex')
}

/** The tools sealed under a key, or undefined when the payload belongs to another key. */
export function parseSealedTools(raw: string, key: string): readonly McpRuntimeTool[] | undefined {
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed) || parsed.key !== key || !Array.isArray(parsed.tools)) return undefined
  const tools: McpRuntimeTool[] = []
  for (const tool of parsed.tools) {
    if (!isRuntimeTool(tool)) return undefined
    tools.push(tool)
  }
  return tools
}

function parseCacheFile(raw: string, filePath: string): CacheFile {
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed) || !isRecord(parsed.entries) || typeof parsed.version !== 'number') {
    logger.warn('Replacing an MCP tool catalog cache with an unexpected shape', { filePath })
    return { entries: {}, writable: true }
  }
  if (parsed.version !== FILE_VERSION) {
    logger.warn('Ignoring an MCP tool catalog cache from another OpenWaggle version', {
      filePath,
      version: parsed.version,
    })
    return { entries: {}, writable: parsed.version < FILE_VERSION }
  }
  const entries = Object.fromEntries(
    Object.entries(parsed.entries).filter((entry): entry is [string, SealedEntry] =>
      isSealedEntry(entry[1]),
    ),
  )
  return { entries, writable: true }
}

export async function readCacheFile(filePath: string): Promise<CacheFile> {
  try {
    const { size } = await stat(filePath)
    if (size > MAX_FILE_BYTES) {
      logger.warn('Replacing an oversized MCP tool catalog cache', { filePath, size })
      return { entries: {}, writable: true }
    }
    return parseCacheFile(await readFile(filePath, 'utf8'), filePath)
  } catch (error) {
    if (isEnoent(error)) return { entries: {}, writable: true }
    if (error instanceof SyntaxError) {
      logger.warn('Replacing a corrupt MCP tool catalog cache', { filePath })
      return { entries: {}, writable: true }
    }
    throw error
  }
}

async function writeCacheFile(filePath: string, entries: SealedEntries) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify({ version: FILE_VERSION, entries })}\n`, {
      encoding: 'utf8',
      mode: FILE_MODE,
    })
    await rename(temporaryPath, filePath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Drops aged-out entries, then the oldest beyond the entry limit. */
function pruneEntries(entries: SealedEntries, now: number): SealedEntries {
  const kept = Object.entries(entries)
    .filter(([, entry]) => now - entry.updatedAt <= MCP_CONFIG.TOOL_CATALOG_RETENTION_MS)
    .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
    .slice(0, MCP_CONFIG.TOOL_CATALOG_MAX_ENTRIES)
  return Object.fromEntries(kept)
}

/** Whether an update left every entry as it was, so the file need not be rewritten. */
function unchangedEntries(next: SealedEntries, current: SealedEntries) {
  const keys = Object.keys(next)
  return (
    keys.length === Object.keys(current).length && keys.every((key) => next[key] === current[key])
  )
}

/**
 * Read-modify-writes of the cache file, serialized in this process and across processes. Each
 * resolves true once a change was written.
 */
export function createCacheFileWriter(filePath: string, now: () => number) {
  let queue: Promise<void> = Promise.resolve()
  return function mutate(update: (entries: SealedEntries, at: number) => SealedEntries) {
    const run = queue.then(async () => {
      // Created private before the lock helper would create it with default permissions.
      await mkdir(path.dirname(filePath), { recursive: true, mode: DIRECTORY_MODE })
      return withProcessFileLock(filePath, async () => {
        const file = await readCacheFile(filePath)
        if (!file.writable) return false
        const at = now()
        const next = pruneEntries(update(file.entries, at), at)
        if (unchangedEntries(next, file.entries)) return false
        await writeCacheFile(filePath, next)
        return true
      })
    })
    queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}
