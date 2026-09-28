import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { isEnoent } from '@shared/utils/node-error'
import { createLogger } from '../../../logger'
import { withProcessFileLock } from '../process-file-lock'
import { InMemoryMcpToolCatalogCache, type McpToolCatalogCache } from './tool-catalog-cache'
import type { McpRuntimeTool } from './types'

const logger = createLogger('mcp-tool-catalog-cache')

const FILE_VERSION = 1
const DIRECTORY_MODE = 0o700
const FILE_MODE = 0o600
/** An unchanged list is re-sealed this often, so a server in daily use never ages out. */
const REFRESH_PERSISTED_AFTER_MS = 86_400_000

export interface McpToolCatalogEncryption {
  readonly isEncryptionAvailable: () => boolean
  readonly encryptString: (value: string) => Buffer
  readonly decryptString: (value: Buffer) => string
}

interface SealedEntry {
  readonly updatedAt: number
  readonly sealed: string
}

type SealedEntries = Readonly<Record<string, SealedEntry>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSealedEntry(value: unknown): value is SealedEntry {
  return isRecord(value) && typeof value.updatedAt === 'number' && typeof value.sealed === 'string'
}

function isRuntimeTool(value: unknown): value is McpRuntimeTool {
  if (!isRecord(value) || typeof value.name !== 'string') return false
  return (
    (value.title === undefined || typeof value.title === 'string') &&
    (value.description === undefined || typeof value.description === 'string')
  )
}

function parseTools(raw: string): readonly McpRuntimeTool[] | undefined {
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed) || !Array.isArray(parsed.tools)) return undefined
  const tools: McpRuntimeTool[] = []
  for (const tool of parsed.tools) {
    if (!isRuntimeTool(tool)) return undefined
    tools.push(tool)
  }
  return tools
}

/** Reads the sealed entries; a missing, corrupt or foreign-version file reads as empty. */
async function readSealedEntries(filePath: string): Promise<SealedEntries> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    if (isEnoent(error)) return {}
    throw error
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.version !== FILE_VERSION || !isRecord(parsed.entries)) return {}
    return Object.fromEntries(
      Object.entries(parsed.entries).filter((entry): entry is [string, SealedEntry] =>
        isSealedEntry(entry[1]),
      ),
    )
  } catch {
    return {}
  }
}

async function writeSealedEntries(filePath: string, entries: SealedEntries) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: DIRECTORY_MODE })
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

/**
 * The tool list cache ADR 0013 allows: sealed with OS encryption and holding only tool
 * definitions, never credentials, results or App state.
 *
 * Entries are sealed one by one under an opaque key, so the file names no server, tool or
 * project. An entry this app cannot open (another OpenWaggle channel seals with its own key) is
 * kept for that app and read here as a miss. Without OS encryption the cache lives in memory only.
 */
export function createEncryptedMcpToolCatalogCache(input: {
  readonly filePath: string
  readonly encryption: McpToolCatalogEncryption
  readonly now?: () => number
}): McpToolCatalogCache {
  const now = input.now ?? Date.now
  const memory = new InMemoryMcpToolCatalogCache(now)
  const persistedAt = new Map<string, number>()
  let writeQueue: Promise<void> = Promise.resolve()

  function unseal(entry: SealedEntry) {
    try {
      return parseTools(input.encryption.decryptString(Buffer.from(entry.sealed, 'base64')))
    } catch {
      return undefined
    }
  }

  async function readPersisted(key: string) {
    if (!input.encryption.isEncryptionAvailable()) return undefined
    const entry = (await readSealedEntries(input.filePath))[key]
    if (!entry || now() - entry.updatedAt > MCP_CONFIG.TOOL_CATALOG_RETENTION_MS) return undefined
    const tools = unseal(entry)
    if (!tools) return undefined
    memory.set(key, tools, entry.updatedAt)
    persistedAt.set(key, entry.updatedAt)
    return tools
  }

  function persist(key: string, tools: readonly McpRuntimeTool[]) {
    const sealed = input.encryption.encryptString(JSON.stringify({ tools })).toString('base64')
    if (sealed.length > MCP_CONFIG.TOOL_CATALOG_MAX_ENTRY_BYTES) return Promise.resolve()
    const write = writeQueue.then(() =>
      withProcessFileLock(input.filePath, async () => {
        const updatedAt = now()
        const entries = await readSealedEntries(input.filePath)
        await writeSealedEntries(
          input.filePath,
          pruneEntries({ ...entries, [key]: { updatedAt, sealed } }, updatedAt),
        )
        persistedAt.set(key, updatedAt)
      }),
    )
    writeQueue = write.catch(() => undefined)
    return write
  }

  return {
    async read(key) {
      const cached = memory.get(key)
      if (cached) return cached.tools
      try {
        return await readPersisted(key)
      } catch (error) {
        logger.warn('Could not read the MCP tool catalog cache', { error: String(error) })
        return undefined
      }
    },
    async write(key, tools) {
      const changed = memory.set(key, tools)
      if (!input.encryption.isEncryptionAvailable()) return
      const lastPersisted = persistedAt.get(key)
      const stale =
        lastPersisted === undefined || now() - lastPersisted > REFRESH_PERSISTED_AFTER_MS
      if (!changed && !stale) return
      try {
        await persist(key, tools)
      } catch (error) {
        logger.warn('Could not write the MCP tool catalog cache', { error: String(error) })
      }
    },
  }
}
