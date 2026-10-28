/**
 * The last `initialize` result and `tools/list` pages of one server, kept per server identity and
 * connection config (D1.3, C2-a). A Session whose server has a catalog is answered from it at
 * once, so Pi registers the same tools before the first model request of every Run, and a stdio
 * server's process starts only when a request needs it: a tool call, resources, prompts.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseJsonUnknown, Schema, safeDecodeUnknown } from '@shared/schema'
import { isRecord } from '@shared/utils/validation'

/** A catalog older than this is not served: the server starts and the catalog is refreshed. */
/** Hex characters of a catalog key: its file name. */
const CATALOG_KEY_LENGTH = 32

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

/** One file per catalog key under `directory`. */
export function fileBackedMcpToolCatalogStore(directory: () => string): McpToolCatalogStore {
  const file = (key: string) => path.join(directory(), `${key}.json`)
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
        mkdirSync(directory(), { recursive: true })
        const temporary = `${file(key)}.${process.pid}.tmp`
        writeFileSync(temporary, JSON.stringify({ version: 1, ...catalog }))
        // Replaced whole, so a concurrent read sees the old or the new catalog.
        renameSync(temporary, file(key))
      } catch {
        // Not cached: the server starts with its Session next time too.
      }
    },
    forget: (key) => {
      rmSync(file(key), { force: true })
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
  observeResult: ((method: string, params: unknown, result: unknown) => void) | undefined,
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
    observeResult: (method: string, params: unknown, result: unknown) => {
      observeResult?.(method, params, result)
      if (method === 'tools/list') catalog.recordToolsPage(params, result)
    },
  }
}
