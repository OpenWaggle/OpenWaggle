import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { isEnoent } from '@shared/utils/node-error'
import { createLogger } from '../../../logger'
import { withProcessFileLock } from '../process-file-lock'
import {
  InMemoryMcpToolCatalogCache,
  type McpToolCatalogCache,
  type McpToolCatalogIdentity,
} from './tool-catalog-cache'
import type { McpRuntimeTool } from './types'

const logger = createLogger('mcp-tool-catalog-cache')

const FILE_VERSION = 1
const DIRECTORY_MODE = 0o700
const FILE_MODE = 0o600
/** An unchanged list is re-sealed this often, so a server in daily use never ages out. */
const REFRESH_PERSISTED_AFTER_MS = 86_400_000
const MAX_FILE_BYTES = MCP_CONFIG.TOOL_CATALOG_MAX_ENTRIES * MCP_CONFIG.TOOL_CATALOG_MAX_ENTRY_BYTES

export interface McpToolCatalogEncryption {
  readonly isEncryptionAvailable: () => boolean
  readonly encryptString: (value: string) => Buffer
  readonly decryptString: (value: Buffer) => string
}

interface SealedEntry {
  readonly updatedAt: number
  /** Which server the entry belongs to, hashed, so it can be forgotten without being opened. */
  readonly server: string
  readonly sealed: string
}

type SealedEntries = Readonly<Record<string, SealedEntry>>

interface CacheFile {
  readonly entries: SealedEntries
  /** False for a file a newer OpenWaggle wrote: it is read as empty and never overwritten. */
  readonly writable: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSealedEntry(value: unknown): value is SealedEntry {
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

function serverTag(serverInstanceId: string) {
  return createHash('sha256').update(`mcp-tool-catalog-server\0${serverInstanceId}`).digest('hex')
}

/** The tools sealed under a key, or undefined when the payload belongs to another key. */
function parseSealedTools(raw: string, key: string): readonly McpRuntimeTool[] | undefined {
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

async function readCacheFile(filePath: string): Promise<CacheFile> {
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
 * The tool list cache ADR 0013 allows: sealed with OS encryption and holding only tool
 * definitions, never credentials, results or App state.
 *
 * Each entry is sealed on its own together with its key, under an opaque key, so the file names
 * no server, tool or project and a payload moved under another key does not open. Aged-out
 * entries are pruned the first time the cache is used in a process. Without OS encryption the
 * cache lives in memory only.
 */
export function createEncryptedMcpToolCatalogCache(input: {
  readonly filePath: string
  readonly encryption: McpToolCatalogEncryption
  readonly now?: () => number
}): McpToolCatalogCache {
  const now = input.now ?? Date.now
  const memory = new InMemoryMcpToolCatalogCache(now)
  const persistedAt = new Map<string, number>()
  let queue: Promise<void> = Promise.resolve()
  let pruned = false

  function unseal(entry: SealedEntry, key: string) {
    try {
      return parseSealedTools(
        input.encryption.decryptString(Buffer.from(entry.sealed, 'base64')),
        key,
      )
    } catch {
      // Sealed by another OpenWaggle channel or install, whose key this one does not hold.
      return undefined
    }
  }

  /** Runs one read-modify-write of the file, serialized in this process and across processes. */
  function mutate(update: (entries: SealedEntries, at: number) => SealedEntries) {
    const run = queue.then(async () => {
      // Created private before the lock helper would create it with default permissions.
      await mkdir(path.dirname(input.filePath), { recursive: true, mode: DIRECTORY_MODE })
      await withProcessFileLock(input.filePath, async () => {
        const file = await readCacheFile(input.filePath)
        if (!file.writable) return
        const at = now()
        const next = pruneEntries(update(file.entries, at), at)
        if (unchangedEntries(next, file.entries)) return
        await writeCacheFile(input.filePath, next)
      })
    })
    queue = run.catch(() => undefined)
    return run
  }

  async function guarded(operation: string, work: () => Promise<void>) {
    try {
      await work()
    } catch (error) {
      logger.warn(`Could not ${operation} the MCP tool catalog cache`, { error: String(error) })
    }
  }

  function pruneOnce() {
    if (pruned || !input.encryption.isEncryptionAvailable()) return Promise.resolve()
    pruned = true
    return guarded('prune', () => mutate((entries) => entries))
  }

  async function readPersisted(identity: McpToolCatalogIdentity) {
    const entry = (await readCacheFile(input.filePath)).entries[identity.key]
    if (!entry || now() - entry.updatedAt > MCP_CONFIG.TOOL_CATALOG_RETENTION_MS) return undefined
    const tools = unseal(entry, identity.key)
    if (!tools) return undefined
    memory.set(identity, tools, entry.updatedAt)
    persistedAt.set(identity.key, entry.updatedAt)
    return tools
  }

  function persist(identity: McpToolCatalogIdentity, tools: readonly McpRuntimeTool[]) {
    const payload = JSON.stringify({ key: identity.key, tools })
    const sealed = input.encryption.encryptString(payload).toString('base64')
    if (sealed.length > MCP_CONFIG.TOOL_CATALOG_MAX_ENTRY_BYTES) {
      logger.warn('Not caching an MCP tool list over the size limit', { bytes: sealed.length })
      return Promise.resolve()
    }
    const server = serverTag(identity.serverInstanceId)
    return mutate((entries, at) => {
      persistedAt.set(identity.key, at)
      return { ...entries, [identity.key]: { updatedAt: at, server, sealed } }
    })
  }

  return {
    async read(identity) {
      const cached = memory.get(identity.key)
      if (cached) return cached.tools
      if (!input.encryption.isEncryptionAvailable()) return undefined
      await pruneOnce()
      try {
        return await readPersisted(identity)
      } catch (error) {
        logger.warn('Could not read the MCP tool catalog cache', { error: String(error) })
        return undefined
      }
    },
    async write(identity, tools) {
      const changed = memory.set(identity, tools)
      if (!input.encryption.isEncryptionAvailable()) return
      await pruneOnce()
      const lastPersisted = persistedAt.get(identity.key)
      const stale =
        lastPersisted === undefined || now() - lastPersisted > REFRESH_PERSISTED_AFTER_MS
      if (!changed && !stale) return
      await guarded('write', () => persist(identity, tools))
    },
    async forgetServer(serverInstanceId) {
      memory.forget(serverInstanceId)
      if (!input.encryption.isEncryptionAvailable()) return
      const server = serverTag(serverInstanceId)
      await guarded('forget a server in', () =>
        mutate((entries) =>
          Object.fromEntries(
            Object.entries(entries).filter(([, entry]) => entry.server !== server),
          ),
        ),
      )
    },
  }
}
