import { isRecord } from '@shared/utils/validation'
import { hasToolsCapability, type McpConnectionCatalog } from './mcp-connection-catalog'
import type { McpConnectionHandshake } from './mcp-connection-handshake'
import type { McpConnectionLease } from './mcp-connection-lease'
import { INITIALIZE, INITIALIZED, type McpPooledConnectionOptions } from './mcp-connection-support'
import { isJsonRpcNotification, isJsonRpcRequest, type JsonRpcMessage } from './mcp-wire'

interface LazyStartHost {
  readonly catalog: McpConnectionCatalog
  readonly handshake: McpConnectionHandshake
  /** Opens the server process (or HTTP session). */
  readonly startUpstream: () => Promise<void>
  readonly close: () => void
  readonly sendInternal: (method: string, params: unknown) => Promise<unknown>
  readonly leases: () => Iterable<McpConnectionLease>
  readonly options: Pick<McpPooledConnectionOptions, 'observeResult' | 'adaptResult'>
}

/**
 * A pooled connection that answers its clients from the server's catalog and starts the server
 * only when a request needs it (D1.3). Each Session still gets its own server (ADR 0013): the
 * start is only deferred, and a Session that never calls the server never starts it.
 */
export class McpConnectionLazyStart {
  private started = false
  private waking: Promise<void> | undefined
  /** Whether the catalog can be served: at once, or once another Session filled it. */
  private readonly servable: Promise<boolean> | undefined

  constructor(
    private readonly host: LazyStartHost,
    fill?: Promise<void>,
  ) {
    this.servable = fill?.then(() => host.catalog.reload())
  }

  /** Still answering from the catalog: the server has not been asked to start. */
  get waiting() {
    return !this.started && this.waking === undefined
  }

  /**
   * Starts the server and initializes it as its clients were, then checks its tools against the
   * catalog they were given. A server that cannot start loses its catalog, so the next Session
   * starts it at once and shows why.
   */
  wake() {
    if (this.started) return Promise.resolve()
    this.waking ??= (async () => {
      try {
        await this.host.startUpstream()
        this.started = true
        await this.host.handshake.replay()
      } catch (error) {
        this.host.catalog.forget()
        this.host.close()
        throw error
      }
      void this.revalidateTools()
    })()
    return this.waking
  }

  /** Answers a client from the catalog; false when the message needs the server, now started. */
  async answer(lease: McpConnectionLease, message: JsonRpcMessage) {
    if (this.waking) await this.waking.catch(() => undefined)
    if (this.started) return false
    if (this.servable && !(await this.servable)) {
      // Still no catalog: this Session starts its server and lists for itself.
      await this.wake()
      return false
    }
    const { catalog, handshake, options } = this.host
    if (isJsonRpcNotification(message)) {
      if (message.method === INITIALIZED) handshake.markInitialized()
      // Nothing else a client notifies matters to a server that has not started.
      return true
    }
    if (!isJsonRpcRequest(message)) return false
    const answer = (result: unknown) => {
      lease.deliver({ jsonrpc: '2.0', id: message.id, result })
      return true
    }
    if (message.method === INITIALIZE) {
      handshake.seed(message.params, catalog.servedInitialize)
      return answer(catalog.servedInitialize)
    }
    if (message.method === 'ping') return answer({})
    const page =
      message.method === 'tools/list' ? catalog.servedToolsPage(message.params) : undefined
    if (page) {
      options.observeResult?.(message.method, message.params, page.result)
      return answer(options.adaptResult?.(message.method, page.result) ?? page.result)
    }
    await this.wake()
    return false
  }

  /** Lists the started server's tools; clients re-list when they differ from the catalog. */
  private async revalidateTools() {
    const { catalog, handshake, options } = this.host
    if (!hasToolsCapability(handshake.resultValue)) return
    try {
      await listToolsForCatalog(this.host.sendInternal, options.observeResult)
      if (!catalog.differsFromServed()) return
      for (const lease of this.host.leases()) {
        lease.deliver({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
      }
    } catch {
      // The clients keep the catalog's tools; a call that needs a missing one fails clearly.
    }
  }
}

/**
 * Lists every page of a started server's tools over the connection; the catalog records them
 * through the connection's observers (`mcpConnectionCatalogOptions`).
 */
export async function listToolsForCatalog(
  sendInternal: (method: string, params: unknown) => Promise<unknown>,
  observeResult: McpPooledConnectionOptions['observeResult'],
) {
  let cursor: string | undefined
  do {
    const params = cursor === undefined ? {} : { cursor }
    const result = await sendInternal('tools/list', params)
    observeResult?.('tools/list', params, result)
    cursor =
      isRecord(result) && typeof result.nextCursor === 'string' ? result.nextCursor : undefined
  } while (cursor !== undefined)
}

/**
 * The Session filling a missing catalog for others lists the tools itself once initialized, so
 * the waiting Sessions do not depend on when its client lists them.
 */
export function fillCatalogAfterHandshake(
  options: Pick<McpPooledConnectionOptions, 'catalog' | 'observeResult'>,
  initializeResult: unknown,
  sendInternal: (method: string, params: unknown) => Promise<unknown>,
) {
  if (!options.catalog?.filled || !hasToolsCapability(initializeResult)) return
  listToolsForCatalog(sendInternal, options.observeResult).catch(() => options.catalog?.closed())
}

/**
 * The lazy start of a connection whose server has a fresh catalog, or whose catalog another
 * Session is filling, and may start late.
 */
export function lazyStartOf(
  options: Pick<
    McpPooledConnectionOptions,
    'catalog' | 'lazyStart' | 'catalogFill' | 'observeResult' | 'adaptResult'
  >,
  host: Omit<LazyStartHost, 'catalog' | 'options'>,
) {
  const catalog = options.catalog
  if (options.lazyStart !== true || !catalog) return undefined
  if (!catalog.canServe && !options.catalogFill) return undefined
  return new McpConnectionLazyStart({ ...host, catalog, options }, options.catalogFill)
}
