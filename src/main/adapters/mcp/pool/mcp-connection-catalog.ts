/**
 * The last `initialize` result and `tools/list` pages of one server, kept per server identity and
 * connection config (D1.3, C2-a). A Session whose server has a catalog is answered from it at
 * once, so Pi registers the same tools before the first model request of every Run, and a stdio
 * server's process starts only when a request needs it: a tool call, resources, prompts.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { parseJsonUnknown, Schema, safeDecodeUnknown } from '@shared/schema'
import { isRecord } from '@shared/utils/validation'
import { createLogger } from '../../../logger'
import type {
  McpObservedResultContext,
  McpPooledConnectionOptions,
} from './mcp-connection-support'

const logger = createLogger('mcp-tool-catalogs')

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/** Hex characters of a catalog key: its file name. */
const CATALOG_KEY_LENGTH = 32

/** A catalog older than this is not served: the server starts and the catalog is refreshed. */
export const MCP_TOOL_CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1_000

const CatalogSchema = Schema.Struct({
  version: Schema.Literal(1),
  initialize: Schema.Unknown,
  toolsPages: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  savedAt: Schema.Number,
})
export type McpToolCatalog = Omit<typeof CatalogSchema.Type, 'version'>

export interface McpToolCatalogStore {
  readonly read: (key: string) => McpToolCatalog | undefined
  readonly write: (key: string, catalog: McpToolCatalog) => void
  readonly forget: (key: string) => void
}

/**
 * Catalogs hold server instructions (sometimes an account or tenant name), so they are private to
 * the user like the rest of `<userData>/mcp` (review R5 P3-2).
 */
const CATALOG_DIRECTORY_MODE = 0o700
const CATALOG_FILE_MODE = 0o600

/**
 * Removes catalogs too old to be served (and temporary files a crash left), which nothing reads
 * again: a removed server, an edited configuration, or a deleted project leaves one behind.
 */
export async function pruneMcpToolCatalogs(directory: string, now: number = Date.now()) {
  let names: string[]
  try {
    names = await readdir(directory)
  } catch {
    return
  }
  for (const name of names) {
    if (!name.endsWith('.json') && !name.endsWith('.tmp')) continue
    const file = path.join(directory, name)
    try {
      const { mtimeMs } = await stat(file)
      if (now - mtimeMs >= MCP_TOOL_CATALOG_MAX_AGE_MS) await rm(file, { force: true })
    } catch (error) {
      logger.warn('Could not prune an MCP tool catalog', { file: name, error: errorText(error) })
    }
  }
}

/** One file per catalog key under `directory`. */
export function fileBackedMcpToolCatalogStore(directory: () => string): McpToolCatalogStore {
  const file = (key: string) => path.join(directory(), `${key}.json`)
  // Once per Host, at its first write: by then the directory is known to be in use.
  let pruned = false
  return {
    read: (key) => {
      try {
        const decoded = safeDecodeUnknown(
          CatalogSchema,
          parseJsonUnknown(readFileSync(file(key), 'utf8')),
        )
        if (!decoded.success) return undefined
        const { version: _version, ...catalog } = decoded.data
        return catalog
      } catch {
        return undefined
      }
    },
    write: (key, catalog) => {
      try {
        mkdirSync(directory(), { recursive: true, mode: CATALOG_DIRECTORY_MODE })
        const temporary = `${file(key)}.${process.pid}.tmp`
        writeFileSync(temporary, JSON.stringify({ version: 1, ...catalog }), {
          mode: CATALOG_FILE_MODE,
        })
        // Replaced whole, so a concurrent read sees the old or the new catalog.
        renameSync(temporary, file(key))
      } catch (error) {
        // Not cached: the server starts with its Session next time too.
        logger.warn('Could not save an MCP tool catalog', { key, error: errorText(error) })
      }
      if (!pruned) {
        pruned = true
        void pruneMcpToolCatalogs(directory())
      }
    },
    forget: (key) => {
      try {
        rmSync(file(key), { force: true })
      } catch (error) {
        // A catalog that stays is still checked against its server when the server starts.
        logger.warn('Could not forget an MCP tool catalog', { key, error: errorText(error) })
      }
    },
  }
}

/** An in-memory store, for tests and Hosts without user data. */
export function memoryMcpToolCatalogStore(): McpToolCatalogStore {
  const catalogs = new Map<string, McpToolCatalog>()
  return {
    read: (key) => catalogs.get(key),
    write: (key, catalog) => {
      catalogs.set(key, catalog)
    },
    forget: (key) => {
      catalogs.delete(key)
    },
  }
}

/**
 * The catalog key of a server: its identity plus what the connection is made of, without the
 * Run's working directory (every worktree of a project shares it) but with its project.
 */
export function mcpToolCatalogKey(input: {
  readonly identity: string
  readonly connectionFingerprint: string
  readonly projectPath: string | null
}) {
  return createHash('sha256')
    .update(`${input.identity}\0${input.connectionFingerprint}\0${input.projectPath ?? ''}`)
    .digest('hex')
    .slice(0, CATALOG_KEY_LENGTH)
}

function cursorOf(params: unknown) {
  return isRecord(params) && typeof params.cursor === 'string' ? params.cursor : ''
}

export function hasToolsCapability(initialize: unknown) {
  return (
    isRecord(initialize) && isRecord(initialize.capabilities) && 'tools' in initialize.capabilities
  )
}

/** The catalog side of one pooled connection: what it records, and what it answers while lazy. */
export class McpConnectionCatalog {
  private initialize: { readonly value: unknown } | undefined
  private pages: Record<string, unknown> = {}
  private served: McpToolCatalog | undefined
  /** Set on the connection that fills a missing catalog for others (`McpCatalogFills`). */
  filled: (() => void) | undefined

  constructor(
    private readonly store: McpToolCatalogStore,
    private readonly key: string,
    private readonly now: () => number = Date.now,
  ) {
    this.reload()
  }

  /** Reads the stored catalog again, as another connection may have filled it; fresh or not. */
  reload() {
    const stored = this.store.read(this.key)
    const age = stored ? this.now() - stored.savedAt : Number.POSITIVE_INFINITY
    this.served = stored && age >= 0 && age < MCP_TOOL_CATALOG_MAX_AGE_MS ? stored : undefined
    return this.canServe
  }

  /** The connection closed: a fill it owed others ends, filled or not. */
  closed() {
    this.filled?.()
  }

  /** A fresh catalog exists, so the connection can answer without its server. */
  get canServe() {
    return this.served !== undefined
  }

  get servedInitialize() {
    return this.served?.initialize
  }

  /** Every cached `tools/list` page. */
  servedToolPages(): readonly unknown[] {
    return Object.values(this.served?.toolsPages ?? {})
  }

  /** The cached `tools/list` page for the request's cursor. */
  servedToolsPage(params: unknown): { readonly result: unknown } | undefined {
    const page = this.served?.toolsPages[cursorOf(params)]
    return page === undefined ? undefined : { result: page }
  }

  recordInitialize(result: unknown) {
    this.initialize = { value: result }
    this.pages = {}
    // A server without tools is never asked for them: its catalog is complete now.
    if (!hasToolsCapability(result)) this.save()
  }

  /** Records a listed page; the last page (no `nextCursor`) completes and saves the catalog. */
  recordToolsPage(params: unknown, result: unknown) {
    this.pages[cursorOf(params)] = result
    if (!(isRecord(result) && typeof result.nextCursor === 'string')) this.save()
  }

  /** Whether the tools now recorded differ from those that were served. */
  differsFromServed() {
    return JSON.stringify(this.pages) !== JSON.stringify(this.served?.toolsPages ?? {})
  }

  /** The server failed to start: the next Session starts it and shows the failure. */
  forget() {
    this.store.forget(this.key)
  }

  private save() {
    if (!this.initialize) return
    this.store.write(this.key, {
      initialize: this.initialize.value,
      toolsPages: { ...this.pages },
      savedAt: this.now(),
    })
    this.filled?.()
  }
}

/** How long a Session waits for another Session's server to fill a missing catalog. */
export const MCP_CATALOG_FILL_WAIT_MS = 30_000

/**
 * Catalogs being filled, one per catalog key (cold wave). When several Sessions start a server
 * whose catalog is missing or stale, the first starts it and fills the catalog; the others wait
 * for that (at most `MCP_CATALOG_FILL_WAIT_MS`) and are then answered from it, starting their own
 * server only when they need it, so a Hive's first wave does not start every server in every
 * Session. Each Session still has its own server process (ADR 0013).
 */
export class McpCatalogFills {
  private readonly fills = new Map<string, Promise<void>>()

  /** The fill to wait for, or none when this caller fills it: `done` ends its fill. */
  join(key: string): { readonly fill: Promise<void> } | { readonly done: () => void } {
    const fill = this.fills.get(key)
    if (fill) return { fill }
    const { promise, resolve } = Promise.withResolvers<void>()
    const timer = setTimeout(resolve, MCP_CATALOG_FILL_WAIT_MS)
    timer.unref()
    const ended = promise.then(() => {
      clearTimeout(timer)
      if (this.fills.get(key) === ended) this.fills.delete(key)
    })
    this.fills.set(key, ended)
    return { done: resolve }
  }
}

/**
 * The catalog options of a pooled server's connection, when the pool keeps catalogs: the
 * catalog records every `tools/list` result the connection sees, alongside the other observers.
 * A lazy server without a fresh catalog either fills it or waits for the Session that does.
 */
export function mcpConnectionCatalogOptions(
  store: McpToolCatalogStore | undefined,
  spec: { readonly catalogKey?: string; readonly lazyStart?: boolean },
  observeResult: McpPooledConnectionOptions['observeResult'],
  fills?: McpCatalogFills,
) {
  if (!store || spec.catalogKey === undefined) return observeResult ? { observeResult } : {}
  const catalog = new McpConnectionCatalog(store, spec.catalogKey)
  const lazyStart = spec.lazyStart === true
  const joined = lazyStart && fills && !catalog.canServe ? fills.join(spec.catalogKey) : undefined
  if (joined && 'done' in joined) catalog.filled = joined.done
  return {
    catalog,
    lazyStart,
    ...(joined && 'fill' in joined ? { catalogFill: joined.fill } : {}),
    observeResult: (
      method: string,
      params: unknown,
      result: unknown,
      context?: McpObservedResultContext,
    ) => {
      observeResult?.(method, params, result, context)
      // A page the catalog served is its own: only what the server lists is recorded.
      if (method === 'tools/list' && context?.served !== true) {
        catalog.recordToolsPage(params, result)
      }
    },
  }
}
