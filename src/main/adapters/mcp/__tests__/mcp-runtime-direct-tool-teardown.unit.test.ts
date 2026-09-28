import { describe, expect, it, vi } from 'vitest'
import { InMemoryMcpToolCatalogCache, mcpToolCatalogIdentity } from '../runtime/tool-catalog-cache'
import type { McpClientConnection, McpRuntimeTool } from '../runtime/types'
import {
  abortableConnect,
  directSnapshot,
  GRACE_MS,
  SEARCH_TOOL,
  settle,
} from './mcp-direct-tool-test-utils'
import {
  connection,
  createMcpRuntimeServiceForTests as createMcpRuntimeService,
} from './mcp-runtime-test-utils'

const TEARDOWN_MS = 100

function identityOf(target = directSnapshot()) {
  const [first] = target.servers
  if (!first) throw new Error('The snapshot has no server.')
  return mcpToolCatalogIdentity(target, first)
}

/** A connection whose close lets an in-flight listing answer, as a stdio server does on EOF. */
function connectionAnsweringOnClose() {
  let answer = (_tools: readonly McpRuntimeTool[]) => {}
  const listTools = vi.fn(
    () =>
      new Promise<readonly McpRuntimeTool[]>((resolve) => {
        answer = resolve
      }),
  )
  const close = vi.fn(async () => {
    answer([SEARCH_TOOL])
    await new Promise((resolve) => setTimeout(resolve, TEARDOWN_MS / 5))
  })
  const result: McpClientConnection = { ...connection(), listTools, close }
  return { connection: result, listTools }
}

describe('MCP connection teardown around direct tools', () => {
  it('shuts down only once a still-starting server has been torn down', async () => {
    const pending = abortableConnect(undefined, TEARDOWN_MS)
    const service = createMcpRuntimeService({
      connect: pending.connect,
      toolCatalogCache: new InMemoryMcpToolCatalogCache(),
      optionalStartupGraceMs: GRACE_MS,
    })
    const target = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })
    await service.listDirectTools(target)

    await service.disposeAll()

    expect(pending.aborted).toHaveLength(1)
    expect(pending.settledCount()).toBe(1)
  })

  it('does not remember a reply that arrives while its connection closes', async () => {
    const cache = new InMemoryMcpToolCatalogCache()
    const server = connectionAnsweringOnClose()
    const service = createMcpRuntimeService({
      connect: async () => server.connection,
      toolCatalogCache: cache,
      optionalStartupGraceMs: GRACE_MS,
    })
    const target = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })
    await service.listDirectTools(target)
    await vi.waitFor(() => expect(server.listTools).toHaveBeenCalledOnce())

    await service.forgetToolCatalog({ serverInstanceId: 'server-1' })
    await service.disposeSession('session-1')
    await settle()

    await expect(cache.read(identityOf(target))).resolves.toBeUndefined()
  })

  it('lets a new connection on a forgotten slot key be remembered', async () => {
    const cache = new InMemoryMcpToolCatalogCache()
    const write = vi.spyOn(cache, 'write')
    const pending = abortableConnect(undefined, TEARDOWN_MS)
    let attempts = 0
    const service = createMcpRuntimeService({
      connect: (input) => {
        attempts += 1
        return attempts === 1
          ? pending.connect(input)
          : Promise.resolve(connection({ tools: [SEARCH_TOOL] }))
      },
      toolCatalogCache: cache,
      optionalStartupGraceMs: GRACE_MS,
    })
    const target = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })
    await service.listDirectTools(target)
    await service.completeTurn({ sessionId: 'session-1', nextSnapshot: target })
    await service.reconcileIdleConnections()
    // The slot is still a tombstone while its aborted connect tears down.
    await service.forgetToolCatalog({ serverInstanceId: 'server-1' })
    await new Promise((resolve) => setTimeout(resolve, TEARDOWN_MS * 2))

    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })
    await service.listDirectTools(target)

    await vi.waitFor(() => expect(write).toHaveBeenCalledWith(identityOf(target), [SEARCH_TOOL]))
  })

  it('leaves a later turn’s still-connecting notice alone when an older connect is retired', async () => {
    const first = abortableConnect(undefined, TEARDOWN_MS)
    const second = abortableConnect()
    let attempts = 0
    const service = createMcpRuntimeService({
      connect: (input) => {
        attempts += 1
        return attempts === 1 ? first.connect(input) : second.connect(input)
      },
      toolCatalogCache: new InMemoryMcpToolCatalogCache(),
      optionalStartupGraceMs: GRACE_MS,
    })
    const target = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })
    await service.listDirectTools(target)
    const next = { ...target, revision: 'revision-2' }
    await service.completeTurn({ sessionId: 'session-1', nextSnapshot: next })
    await service.prepareTurn({ sessionId: 'session-1', snapshot: next })
    await service.listDirectTools(next)

    await new Promise((resolve) => setTimeout(resolve, TEARDOWN_MS * 2))

    expect(first.settledCount()).toBe(1)
    expect(await service.getNotices('session-1')).toEqual([
      expect.objectContaining({ severity: 'info', title: expect.stringContaining('still') }),
    ])
    second.release()
  })
})
