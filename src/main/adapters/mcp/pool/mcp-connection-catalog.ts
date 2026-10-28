/**
 * The last `initialize` result and `tools/list` pages of one server, kept per server identity and
 * connection config (D1.3, C2-a). A Session whose server has a catalog is answered from it at
 * once, so Pi registers the same tools before the first model request of every Run, and a stdio
 * server's process starts only when a request needs it: a tool call, resources, prompts.
 */
import { createHash } from 'node:crypto'
import { isRecord } from '@shared/utils/validation'
import type { McpObservedResultContext, McpPooledConnectionOptions } from './mcp-connection-support'
import {
  MCP_TOOL_CATALOG_MAX_AGE_MS,
  type McpToolCatalog,
  type McpToolCatalogStore,
} from './mcp-tool-catalog-store'

export {
  fileBackedMcpToolCatalogStore,
  MCP_TOOL_CATALOG_MAX_AGE_MS,
  type McpToolCatalog,
  type McpToolCatalogStore,
  memoryMcpToolCatalogStore,
  pruneMcpToolCatalogs,
} from './mcp-tool-catalog-store'

/** Hex characters of a catalog key: its file name. */
const CATALOG_KEY_LENGTH = 32

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

/** How long a Session waits for another Session's server to fill a missing catalog, at most. */
export const MCP_CATALOG_FILL_WAIT_MS = 30_000

/** Pi's per-request timeout of an MCP server without `timeout`, in seconds. */
const PI_DEFAULT_REQUEST_TIMEOUT_SECONDS = 60
const MS_PER_SECOND = 1_000
/** Each wait before a server's own start may take this share of its request timeout. */
const STARTUP_WAIT_SHARE = 3

/**
 * How long one step before a server answers may wait (a cold wave's catalog fill, the package
 * runner's probe): a third of Pi's request timeout for the server (`timeout`, 60 s by default),
 * at most `cap`, so the waits and the server's own start fit in the `initialize` or `tools/call`
 * that waits for them (review R5 P3-5).
 */
export function mcpStartupWaitMs(timeoutSeconds: number | undefined, cap: number) {
  const timeoutMs = (timeoutSeconds ?? PI_DEFAULT_REQUEST_TIMEOUT_SECONDS) * MS_PER_SECOND
  return Math.max(0, Math.min(cap, Math.floor(timeoutMs / STARTUP_WAIT_SHARE)))
}

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
  join(
    key: string,
    waitMs: number = MCP_CATALOG_FILL_WAIT_MS,
  ): { readonly fill: Promise<void> } | { readonly done: () => void } {
    const fill = this.fills.get(key)
    if (fill) return { fill: waitAtMost(fill, waitMs) }
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

/** `fill`, or nothing once `waitMs` passed: a waiter's own budget, whatever the filler's is. */
function waitAtMost(fill: Promise<void>, waitMs: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, waitMs)
    timer.unref()
    void fill.then(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/**
 * The catalog options of a pooled server's connection, when the pool keeps catalogs: the
 * catalog records every `tools/list` result the connection sees, alongside the other observers.
 * A lazy server without a fresh catalog either fills it or waits for the Session that does.
 */
export function mcpConnectionCatalogOptions(
  store: McpToolCatalogStore | undefined,
  spec: {
    readonly catalogKey?: string
    readonly lazyStart?: boolean
    readonly catalogFillWaitMs?: number
  },
  observeResult: McpPooledConnectionOptions['observeResult'],
  fills?: McpCatalogFills,
) {
  if (!store || spec.catalogKey === undefined) return observeResult ? { observeResult } : {}
  const catalog = new McpConnectionCatalog(store, spec.catalogKey)
  const lazyStart = spec.lazyStart === true
  const joined =
    lazyStart && fills && !catalog.canServe
      ? fills.join(spec.catalogKey, spec.catalogFillWaitMs)
      : undefined
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
