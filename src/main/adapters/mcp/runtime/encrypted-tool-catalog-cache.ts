import { MCP_CONFIG } from '@shared/constants/mcp'
import { createLogger } from '../../../logger'
import {
  InMemoryMcpToolCatalogCache,
  type McpToolCatalogCache,
  type McpToolCatalogIdentity,
} from './tool-catalog-cache'
import {
  createCacheFileWriter,
  parseSealedTools,
  readCacheFile,
  type SealedEntry,
  serverTag,
} from './tool-catalog-cache-file'
import type { McpRuntimeTool } from './types'

const logger = createLogger('mcp-tool-catalog-cache')

/** An unchanged list is re-sealed this often, so a server in daily use never ages out. */
const REFRESH_PERSISTED_AFTER_MS = 86_400_000

export interface McpToolCatalogEncryption {
  readonly isEncryptionAvailable: () => boolean
  readonly encryptString: (value: string) => Buffer
  readonly decryptString: (value: Buffer) => string
}

/**
 * The tool list cache ADR 0013 allows: sealed with OS encryption and holding only tool
 * definitions, never credentials, results or App state.
 *
 * Each entry is sealed on its own together with its key, under an opaque key, so the file names
 * no server, tool or project and a payload moved under another key does not open. Aged-out
 * entries are ignored on read and pruned by the first write in a process. Without OS encryption the
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
  const mutate = createCacheFileWriter(input.filePath, now)
  let pruned = false
  // Bumped by a forget, so a write that started before it does not bring the list back.
  const forgetGenerations = new Map<string, number>()
  let forgetAllGeneration = 0
  const generationOf = (serverInstanceId: string) =>
    `${String(forgetAllGeneration)}:${String(forgetGenerations.get(serverInstanceId) ?? 0)}`

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

  async function guarded(operation: string, work: () => Promise<unknown>) {
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
    let sealedAt = 0
    // Recorded only once written, so a failed write is retried by the next listing.
    return mutate((entries, at) => {
      sealedAt = at
      return { ...entries, [identity.key]: { updatedAt: at, server, sealed } }
    }).then((written) => {
      if (written) persistedAt.set(identity.key, sealedAt)
    })
  }

  return {
    async read(identity) {
      const cached = memory.get(identity.key)
      if (cached) return cached.tools
      if (!input.encryption.isEncryptionAvailable()) return undefined
      try {
        return await readPersisted(identity)
      } catch (error) {
        logger.warn('Could not read the MCP tool catalog cache', { error: String(error) })
        return undefined
      }
    },
    async write(identity, tools) {
      const generation = generationOf(identity.serverInstanceId)
      const changed = memory.set(identity, tools)
      if (!input.encryption.isEncryptionAvailable()) return
      // Writes run off the turn's path, so the first one in a process also prunes the file.
      await pruneOnce()
      const lastPersisted = persistedAt.get(identity.key)
      const stale =
        lastPersisted === undefined || now() - lastPersisted > REFRESH_PERSISTED_AFTER_MS
      if (!changed && !stale) return
      if (generationOf(identity.serverInstanceId) !== generation) return
      await guarded('write', () => persist(identity, tools))
    },
    async forgetAll() {
      forgetAllGeneration += 1
      await memory.forgetAll()
      if (!input.encryption.isEncryptionAvailable()) return
      await guarded('clear', () => mutate(() => ({})))
    },
    async forgetServer(serverInstanceId) {
      forgetGenerations.set(serverInstanceId, (forgetGenerations.get(serverInstanceId) ?? 0) + 1)
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
