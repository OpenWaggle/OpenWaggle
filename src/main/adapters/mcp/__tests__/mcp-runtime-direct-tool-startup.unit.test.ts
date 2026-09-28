import { describe, expect, it, vi } from 'vitest'
import { InMemoryMcpToolCatalogCache, mcpToolCatalogIdentity } from '../runtime/tool-catalog-cache'
import type { McpRuntimeTool } from '../runtime/types'
import {
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

describe('non-blocking MCP direct tools', () => {
  it('offers cached direct tools without waiting for the server to connect', async () => {
    const gate = gatedConnect()
    const service = createMcpRuntimeService({
      connect: gate.connect,
      toolCatalogCache: await seededCache([SEARCH_TOOL]),
      optionalStartupGraceMs: 60_000,
    })
    const target = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })

    const tools = await service.listDirectTools(target)

    expect(tools).toEqual([expect.objectContaining({ title: 'Search documentation' })])
    // The connection still starts, in the background, so a call finds it warm.
    await vi.waitFor(() => expect(gate.connect).toHaveBeenCalledTimes(1))
    gate.release()
  })

  it('waits for a cached tool call until its server has connected', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'found' }],
      isError: false,
    }))
    const gate = gatedConnect(() => connection({ tools: [SEARCH_TOOL], callTool }))
    const service = createMcpRuntimeService({
      connect: gate.connect,
      toolCatalogCache: await seededCache([SEARCH_TOOL]),
    })
    const target = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })
    const [tool] = await service.listDirectTools(target)
    if (!tool) throw new Error('Expected a cached direct tool.')

    const call = service.executeGateway(target, {
      operation: 'call',
      handle: tool.handle,
      arguments: { query: 'install' },
    })
    await settle()
    expect(callTool).not.toHaveBeenCalled()
    gate.release()

    await expect(call).resolves.toMatchObject({ operation: 'call', isError: false })
    expect(callTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'search_private_docs' }))
  })

  it('refuses a cached tool the server no longer offers', async () => {
    const gate = gatedConnect(() => connection({ tools: [] }))
    const service = createMcpRuntimeService({
      connect: gate.connect,
      toolCatalogCache: await seededCache([SEARCH_TOOL]),
    })
    const target = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })
    const [tool] = await service.listDirectTools(target)
    if (!tool) throw new Error('Expected a cached direct tool.')
    gate.release()

    await expect(
      service.executeGateway(target, { operation: 'call', handle: tool.handle, arguments: {} }),
    ).rejects.toThrow('no longer offers the MCP tool search_private_docs')
  })

  it('refuses a cached tool whose input schema changed since it was cached', async () => {
    const changed: McpRuntimeTool = {
      ...SEARCH_TOOL,
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    }
    const callTool = vi.fn(async () => ({ content: [], isError: false }))
    const gate = gatedConnect(() => connection({ tools: [changed], callTool }))
    const service = createMcpRuntimeService({
      connect: gate.connect,
      toolCatalogCache: await seededCache([SEARCH_TOOL]),
    })
    const target = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })
    const [tool] = await service.listDirectTools(target)
    if (!tool) throw new Error('Expected a cached direct tool.')
    gate.release()

    await expect(
      service.executeGateway(target, {
        operation: 'call',
        handle: tool.handle,
        arguments: { query: 'install' },
      }),
    ).rejects.toThrow('changed its input schema')
    expect(callTool).not.toHaveBeenCalled()
  })

  it('starts the turn without an uncached optional server once its short grace ends', async () => {
    const gate = gatedConnect(() => connection({ tools: [SEARCH_TOOL] }))
    const onWaiting = vi.fn()
    const service = createMcpRuntimeService({
      connect: gate.connect,
      toolCatalogCache: new InMemoryMcpToolCatalogCache(),
      optionalStartupGraceMs: GRACE_MS,
    })
    const target = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })

    const onWaitSettled = vi.fn()
    await expect(service.listDirectTools(target, { onWaiting, onWaitSettled })).resolves.toEqual([])

    expect(onWaiting).toHaveBeenCalledWith(['private-docs-server'])
    expect(onWaitSettled).toHaveBeenCalledWith({
      connected: [],
      stillConnecting: ['private-docs-server'],
      unavailable: [],
    })
    expect(await service.getNotices('session-1')).toEqual([
      expect.objectContaining({
        id: 'runtime:server-1:connect',
        severity: 'info',
        title: 'private-docs-server MCP server is still connecting',
      }),
    ])

    gate.release()
    // The background connection finished: the notice clears and the next turn has the tools.
    await vi.waitFor(async () => expect(await service.getNotices('session-1')).toEqual([]))
    await expect(service.listDirectTools(target)).resolves.toEqual([
      expect.objectContaining({ title: 'Search documentation' }),
    ])
    expect(gate.connect).toHaveBeenCalledTimes(1)
  })

  it('uses an uncached optional server that connects within its grace', async () => {
    const cache = new InMemoryMcpToolCatalogCache()
    const service = createMcpRuntimeService({
      connect: async () => connection({ tools: [SEARCH_TOOL] }),
      toolCatalogCache: cache,
      optionalStartupGraceMs: 60_000,
    })
    const target = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })

    await expect(service.listDirectTools(target)).resolves.toEqual([
      expect.objectContaining({ title: 'Search documentation' }),
    ])
    const [firstServer] = target.servers
    if (!firstServer) throw new Error('The snapshot has no server.')
    // The cache keeps only what a direct-tool descriptor is built from, written off the turn.
    await vi.waitFor(() =>
      expect(cache.read(mcpToolCatalogIdentity(target, firstServer))).resolves.toEqual([
        SEARCH_TOOL,
      ]),
    )
  })

  it('shares the catalog a first session listed with the next session in the project', async () => {
    const cache = new InMemoryMcpToolCatalogCache()
    const gate = gatedConnect(() => connection({ tools: [SEARCH_TOOL] }))
    const service = createMcpRuntimeService({ connect: gate.connect, toolCatalogCache: cache })
    const first = directSnapshot({}, 'session-1')
    await service.prepareTurn({ sessionId: 'session-1', snapshot: first })
    const firstTools = service.listDirectTools(first)
    await vi.waitFor(() => expect(gate.connect).toHaveBeenCalledTimes(1))
    gate.release()
    await expect(firstTools).resolves.toHaveLength(1)

    const second = directSnapshot({}, 'session-2')
    await service.prepareTurn({ sessionId: 'session-2', snapshot: second })
    await expect(service.listDirectTools(second)).resolves.toEqual([
      expect.objectContaining({ title: 'Search documentation' }),
    ])
    // Each Session still owns its own connection.
    await vi.waitFor(() => expect(gate.connect).toHaveBeenCalledTimes(2))
    gate.release()
  })

  it('still waits for a required server even when its catalog is cached', async () => {
    const gate = gatedConnect(() => connection({ tools: [SEARCH_TOOL] }))
    const required = { definition: { command: 'docs-mcp', directTools: true, required: true } }
    const target = directSnapshot(required)
    const onWaiting = vi.fn()
    const service = createMcpRuntimeService({
      connect: gate.connect,
      toolCatalogCache: await seededCache([SEARCH_TOOL], target),
      optionalStartupGraceMs: GRACE_MS,
    })
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })

    let settled = false
    const tools = service.listDirectTools(target, { onWaiting }).finally(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, GRACE_MS * 2))
    expect(settled).toBe(false)
    expect(onWaiting).toHaveBeenCalledWith(['private-docs-server'])
    gate.release()

    await expect(tools).resolves.toHaveLength(1)
  })

  it('does not report a wait when every direct-tool catalog is ready', async () => {
    const onWaiting = vi.fn()
    const service = createMcpRuntimeService({
      connect: gatedConnect().connect,
      toolCatalogCache: await seededCache([SEARCH_TOOL]),
    })
    const target = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })

    await service.listDirectTools(target, { onWaiting })

    expect(onWaiting).not.toHaveBeenCalled()
  })

  it('reports an optional server that failed within its grace as unavailable', async () => {
    const onWaitSettled = vi.fn()
    const service = createMcpRuntimeService({
      connect: async () => {
        throw new Error('secret cannot be decrypted')
      },
      toolCatalogCache: new InMemoryMcpToolCatalogCache(),
      optionalStartupGraceMs: 60_000,
    })
    const target = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })

    await expect(service.listDirectTools(target, { onWaitSettled })).resolves.toEqual([])

    expect(onWaitSettled).toHaveBeenCalledWith({
      connected: [],
      stillConnecting: [],
      unavailable: ['private-docs-server'],
    })
    expect(await service.getNotices('session-1')).toEqual([
      expect.objectContaining({
        severity: 'warning',
        title: 'private-docs-server MCP server could not connect',
      }),
    ])
  })
})
