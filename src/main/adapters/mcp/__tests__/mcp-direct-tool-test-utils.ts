import type { McpTurnSnapshotServer } from '@shared/types/mcp'
import { vi } from 'vitest'
import { InMemoryMcpToolCatalogCache, mcpToolCatalogIdentity } from '../runtime/tool-catalog-cache'
import type { McpClientConnection, McpRuntimeTool } from '../runtime/types'
import { connection, server, snapshot } from './mcp-runtime-test-utils'

export const GRACE_MS = 25
const SETTLE_MS = 5

export const SEARCH_TOOL: McpRuntimeTool = {
  name: 'search_private_docs',
  title: 'Search documentation',
  description: 'Find a passage in project documentation.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
}

export function directServer(overrides: Partial<McpTurnSnapshotServer> = {}) {
  return server({ definition: { command: 'docs-mcp', directTools: true }, ...overrides })
}

export function directSnapshot(
  overrides: Partial<McpTurnSnapshotServer> = {},
  sessionId = 'session-1',
) {
  return snapshot({ sessionId, servers: [directServer(overrides)] })
}

/** A connection factory whose connects stay pending until the test releases them. */
export function gatedConnect(result: () => McpClientConnection = () => connection()) {
  const releases: (() => void)[] = []
  let open = false
  const connect = vi.fn(
    () =>
      new Promise<McpClientConnection>((resolve) => {
        if (open) resolve(result())
        else releases.push(() => resolve(result()))
      }),
  )
  return {
    connect,
    /** Settles pending connects, and lets later ones through at once. */
    release() {
      open = true
      for (const release of releases.splice(0)) release()
    },
  }
}

export async function seededCache(tools: readonly McpRuntimeTool[], target = directSnapshot()) {
  const cache = new InMemoryMcpToolCatalogCache()
  const [firstServer] = target.servers
  if (!firstServer) throw new Error('The snapshot has no server.')
  await cache.write(mcpToolCatalogIdentity(target, firstServer), tools)
  return cache
}

export function settle() {
  return new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
}

/**
 * A connection factory that honours the connect's abort signal, like the SDK factory: an abort
 * rejects the pending connect at once.
 */
export function abortableConnect(result: () => McpClientConnection = () => connection()) {
  const gate = gatedConnect(result)
  const aborted: AbortSignal[] = []
  const connect = vi.fn(
    (input: { readonly signal?: AbortSignal }) =>
      new Promise<McpClientConnection>((resolve, reject) => {
        input.signal?.addEventListener('abort', () => {
          aborted.push(input.signal ?? new AbortController().signal)
          reject(new Error('MCP connection was cancelled while it started.'))
        })
        void gate.connect().then(resolve, reject)
      }),
  )
  return { connect, release: gate.release, aborted }
}
