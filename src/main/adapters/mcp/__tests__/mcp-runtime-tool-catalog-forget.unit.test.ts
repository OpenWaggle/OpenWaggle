import { describe, expect, it, vi } from 'vitest'
import { InMemoryMcpToolCatalogCache, mcpToolCatalogIdentity } from '../runtime/tool-catalog-cache'
import type { McpClientConnection, McpRuntimeTool } from '../runtime/types'
import {
  abortableConnect,
  directServer,
  directSnapshot,
  GRACE_MS,
  gatedConnect,
  SEARCH_TOOL,
  seededCache,
  settle,
} from './mcp-direct-tool-test-utils'
import {
  connection,
  createMcpRuntimeServiceForTests as createMcpRuntimeService,
} from './mcp-runtime-test-utils'

function identityOf(target = directSnapshot()) {
  const [first] = target.servers
  if (!first) throw new Error('The snapshot has no server.')
  return mcpToolCatalogIdentity(target, first)
}

function failingConnect() {
  return async (): Promise<McpClientConnection> => {
    throw new Error('server binary is missing')
  }
}

describe('remembered MCP tool lists and connect failures', () => {
  it('does not remember a listing that was in flight when the server was forgotten', async () => {
    const cache = new InMemoryMcpToolCatalogCache()
    const gate = gatedConnect(() => connection({ tools: [SEARCH_TOOL] }))
    const service = createMcpRuntimeService({
      connect: gate.connect,
      toolCatalogCache: cache,
      optionalStartupGraceMs: GRACE_MS,
    })
    const target = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })
    await service.listDirectTools(target)

    await service.forgetToolCatalog({ serverInstanceId: 'server-1' })
    gate.release()
    await vi.waitFor(async () =>
      expect(await service.getConnectionStatuses()).toEqual([
        expect.objectContaining({ connectionState: 'connected' }),
      ]),
    )
    await settle()

    await expect(cache.read(identityOf(target))).resolves.toBeUndefined()
  })

  it('clears its own still-connecting notice when a new revision retires the connect', async () => {
    const pending = abortableConnect()
    const service = createMcpRuntimeService({
      connect: pending.connect,
      toolCatalogCache: new InMemoryMcpToolCatalogCache(),
      optionalStartupGraceMs: GRACE_MS,
    })
    const target = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })
    await service.listDirectTools(target)

    await service.completeTurn({
      sessionId: 'session-1',
      nextSnapshot: { ...target, revision: 'revision-2', servers: [] },
    })

    await vi.waitFor(async () => expect(await service.getNotices('session-1')).toEqual([]))
    expect(pending.aborted).toHaveLength(1)
  })

  it('keeps withholding a broken server’s cached tools after a reconcile cleared its warning', async () => {
    const service = createMcpRuntimeService({
      connect: failingConnect(),
      toolCatalogCache: await seededCache([SEARCH_TOOL]),
      optionalStartupGraceMs: GRACE_MS,
    })
    const target = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })
    await service.listDirectTools(target)
    await vi.waitFor(async () =>
      expect(await service.getNotices('session-1')).toEqual([
        expect.objectContaining({ severity: 'warning' }),
      ]),
    )
    await service.completeTurn({ sessionId: 'session-1', nextSnapshot: target })
    await service.reconcileIdleConnections()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })

    await expect(service.listDirectTools(target)).resolves.toEqual([])
  })

  it('keeps withholding them while a retry hangs past the grace', async () => {
    let attempts = 0
    const service = createMcpRuntimeService({
      connect: () => {
        attempts += 1
        return attempts === 1
          ? Promise.reject(new Error('server binary is missing'))
          : new Promise<McpClientConnection>(() => {})
      },
      toolCatalogCache: await seededCache([SEARCH_TOOL]),
      optionalStartupGraceMs: GRACE_MS,
    })
    const target = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })
    await service.listDirectTools(target)
    await vi.waitFor(async () =>
      expect(await service.getNotices('session-1')).toEqual([
        expect.objectContaining({ severity: 'warning' }),
      ]),
    )

    await expect(service.listDirectTools(target)).resolves.toEqual([])
    await expect(service.listDirectTools(target)).resolves.toEqual([])
  })

  it('offers the cached tools again once the configuration changed', async () => {
    const cache = new InMemoryMcpToolCatalogCache()
    const service = createMcpRuntimeService({
      connect: failingConnect(),
      toolCatalogCache: cache,
      optionalStartupGraceMs: GRACE_MS,
    })
    const broken = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: broken })
    await service.listDirectTools(broken)
    await vi.waitFor(async () => expect(await service.getNotices('session-1')).toHaveLength(1))
    const fixed = directSnapshot({ configHash: 'config-2' })
    await cache.write(identityOf(fixed), [SEARCH_TOOL])
    await service.prepareTurn({ sessionId: 'session-1', snapshot: { ...fixed, revision: 'r-2' } })

    await expect(service.listDirectTools({ ...fixed, revision: 'r-2' })).resolves.toHaveLength(1)
  })

  it('does not record a listing that finished after its Session was disposed', async () => {
    let finishListing = (_tools: readonly McpRuntimeTool[]) => {}
    const listTools = vi.fn(
      () =>
        new Promise<readonly McpRuntimeTool[]>((resolve) => {
          finishListing = resolve
        }),
    )
    const connect = vi.fn(async () => ({ ...connection(), listTools }))
    const service = createMcpRuntimeService({
      connect,
      toolCatalogCache: await seededCache([SEARCH_TOOL]),
    })
    const target = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })
    await service.listDirectTools(target)
    await vi.waitFor(() => expect(listTools).toHaveBeenCalledOnce())

    await service.disposeSession('session-1')
    finishListing([SEARCH_TOOL])
    await settle()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })
    await service.listDirectTools(target)

    // Nothing the retired listing learned counts as this Session's fresh catalog.
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2))
  })

  it('remembers neither required servers nor tools that are not exposed directly', async () => {
    const cache = new InMemoryMcpToolCatalogCache()
    const write = vi.spyOn(cache, 'write')
    const other: McpRuntimeTool = { name: 'delete_private_docs' }
    const service = createMcpRuntimeService({
      connect: async () => connection({ tools: [SEARCH_TOOL, other] }),
      toolCatalogCache: cache,
    })
    const required = directSnapshot({
      definition: { command: 'docs-mcp', directTools: true, required: true },
    })
    await service.prepareTurn({ sessionId: 'session-1', snapshot: required })
    await service.listDirectTools(required)
    const selected = directSnapshot(
      { definition: { command: 'docs-mcp', directTools: ['search_private_docs'] } },
      'session-2',
    )
    await service.prepareTurn({ sessionId: 'session-2', snapshot: selected })
    await service.listDirectTools(selected)

    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce())
    expect(write).toHaveBeenCalledWith(identityOf(selected), [SEARCH_TOOL])
    expect(directServer().definition.required).toBeUndefined()
  })
})
