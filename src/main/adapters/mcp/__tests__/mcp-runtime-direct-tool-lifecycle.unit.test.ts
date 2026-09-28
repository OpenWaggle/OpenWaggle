import { MCP_CONFIG } from '@shared/constants/mcp'
import { Duration, Effect, TestClock, TestContext } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { makeMcpRuntimeService } from '../runtime/runtime-service-factory'
import { InMemoryMcpToolCatalogCache } from '../runtime/tool-catalog-cache'
import type { McpRuntimeTool } from '../runtime/types'
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
  server,
  snapshot,
} from './mcp-runtime-test-utils'

const CHANGED_TOOL: McpRuntimeTool = {
  ...SEARCH_TOOL,
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
}

function successfulCall() {
  return vi.fn(async () => ({ content: [{ type: 'text', text: 'found' }], isError: false }))
}

describe('MCP direct tools across the Session lifecycle', () => {
  it('refuses a cached tool whose schema changed even after the live listing landed', async () => {
    const callTool = successfulCall()
    const gate = gatedConnect(() => connection({ tools: [CHANGED_TOOL], callTool }))
    const service = createMcpRuntimeService({
      connect: gate.connect,
      toolCatalogCache: await seededCache([SEARCH_TOOL]),
    })
    const target = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })
    const [tool] = await service.listDirectTools(target)
    if (!tool) throw new Error('Expected a cached direct tool.')
    gate.release()
    await vi.waitFor(async () =>
      expect(await service.getConnectionStatuses()).toEqual([
        expect.objectContaining({ connectionState: 'connected' }),
      ]),
    )
    await settle()

    await expect(
      service.executeGateway(target, {
        operation: 'call',
        handle: tool.handle,
        arguments: { query: 'install' },
      }),
    ).rejects.toThrow('changed its input schema')
    expect(callTool).not.toHaveBeenCalled()
  })

  it('lists a server again once its catalog aged out, and refuses a handle whose schema moved', async () => {
    let tools: readonly McpRuntimeTool[] = [SEARCH_TOOL]
    const listTools = vi.fn(async () => tools)
    const program = Effect.gen(function* () {
      const service = yield* makeMcpRuntimeService({
        connect: async () => ({ ...connection(), listTools }),
      })
      const turn = snapshot()
      const listed = yield* service.executeGateway({
        snapshot: turn,
        request: { operation: 'list' },
      })
      const handle = listed.tools?.[0]?.handle ?? ''
      tools = [CHANGED_TOOL]
      yield* TestClock.adjust(Duration.millis(MCP_CONFIG.CATALOG_CACHE_TTL_MS + 1))
      return yield* service
        .executeGateway({ snapshot: turn, request: { operation: 'describe', handle } })
        .pipe(Effect.flip)
    })

    const error = await Effect.runPromise(program.pipe(Effect.provide(TestContext.TestContext)))

    expect(listTools).toHaveBeenCalledTimes(2)
    expect(error.message).toContain('changed its input schema')
  })

  it('disposes a Session without waiting for its background connect', async () => {
    const pending = abortableConnect()
    const service = createMcpRuntimeService({
      connect: pending.connect,
      toolCatalogCache: await seededCache([SEARCH_TOOL]),
    })
    const target = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })
    await service.listDirectTools(target)
    await vi.waitFor(() => expect(pending.connect).toHaveBeenCalledOnce())

    await service.disposeSession('session-1')
    await service.prepareTurn({ sessionId: 'session-2', snapshot: directSnapshot({}, 'session-2') })

    expect(pending.aborted).toHaveLength(1)
    expect(await service.getNotices('session-1')).toEqual([])
    pending.release()
  })

  it('does not report a connect retired by a new snapshot revision as a failure', async () => {
    const pending = abortableConnect()
    const service = createMcpRuntimeService({
      connect: pending.connect,
      toolCatalogCache: await seededCache([SEARCH_TOOL]),
    })
    const target = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })
    await service.listDirectTools(target)
    await vi.waitFor(() => expect(pending.connect).toHaveBeenCalledOnce())

    await service.completeTurn({
      sessionId: 'session-1',
      nextSnapshot: { ...target, revision: 'revision-2' },
    })
    await settle()

    expect(pending.aborted).toHaveLength(1)
    expect(await service.getNotices('session-1')).toEqual([])
  })

  it('stops offering the cached tools of a server whose last connect failed', async () => {
    const onWaiting = vi.fn()
    const service = createMcpRuntimeService({
      connect: async () => {
        throw new Error('server binary is missing')
      },
      toolCatalogCache: await seededCache([SEARCH_TOOL]),
      optionalStartupGraceMs: GRACE_MS,
    })
    const target = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })
    await expect(service.listDirectTools(target)).resolves.toHaveLength(1)
    await vi.waitFor(async () =>
      expect(await service.getNotices('session-1')).toEqual([
        expect.objectContaining({ severity: 'warning' }),
      ]),
    )

    await expect(service.listDirectTools(target, { onWaiting })).resolves.toEqual([])
    expect(onWaiting).toHaveBeenCalledWith(['private-docs-server'])
  })

  it('fails the turn when a required direct-tool server cannot connect', async () => {
    const service = createMcpRuntimeService({
      connect: async () => {
        throw new Error('server binary is missing')
      },
    })
    const target = directSnapshot({
      definition: { command: 'docs-mcp', directTools: true, required: true },
    })
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })

    await expect(service.listDirectTools(target)).rejects.toThrow(
      'Required MCP server private-docs-server could not connect: server binary is missing',
    )
  })

  it('replaces the still-connecting notice with the failure once the late connect fails', async () => {
    let failConnect = (_error: Error) => {}
    const service = createMcpRuntimeService({
      connect: () =>
        new Promise((_resolve, reject) => {
          failConnect = reject
        }),
      toolCatalogCache: new InMemoryMcpToolCatalogCache(),
      optionalStartupGraceMs: GRACE_MS,
    })
    const target = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })
    await service.listDirectTools(target)
    expect(await service.getNotices('session-1')).toEqual([
      expect.objectContaining({ severity: 'info' }),
    ])

    failConnect(new Error('handshake timed out'))

    await vi.waitFor(async () =>
      expect(await service.getNotices('session-1')).toEqual([
        expect.objectContaining({
          severity: 'warning',
          detail: expect.stringContaining('timed out'),
        }),
      ]),
    )
  })

  it('lists a server once for parallel calls through its cached tools', async () => {
    const listTools = vi.fn(async () => [SEARCH_TOOL])
    const gate = gatedConnect(() => ({ ...connection({ callTool: successfulCall() }), listTools }))
    const service = createMcpRuntimeService({
      connect: gate.connect,
      toolCatalogCache: await seededCache([SEARCH_TOOL]),
    })
    const target = directSnapshot()
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })
    const [tool] = await service.listDirectTools(target)
    if (!tool) throw new Error('Expected a cached direct tool.')
    const call = () =>
      service.executeGateway(target, {
        operation: 'call',
        handle: tool.handle,
        arguments: { query: 'install' },
      })
    const calls = Promise.all([call(), call(), call()])
    gate.release()

    await expect(calls).resolves.toHaveLength(3)
    expect(gate.connect).toHaveBeenCalledOnce()
    expect(listTools).toHaveBeenCalledOnce()
  })

  it('applies a per-tool direct selection to a cached list', async () => {
    const other: McpRuntimeTool = { name: 'delete_private_docs' }
    const target = directSnapshot({
      definition: { command: 'docs-mcp', directTools: ['search_private_docs'] },
    })
    const service = createMcpRuntimeService({
      connect: gatedConnect().connect,
      toolCatalogCache: await seededCache([SEARCH_TOOL, other], target),
    })
    await service.prepareTurn({ sessionId: 'session-1', snapshot: target })

    await expect(service.listDirectTools(target)).resolves.toEqual([
      expect.objectContaining({ title: 'Search documentation' }),
    ])
  })

  it('remembers only direct-tool servers, and only what their descriptors need', async () => {
    const cache = new InMemoryMcpToolCatalogCache()
    const write = vi.spyOn(cache, 'write')
    const withMeta: McpRuntimeTool = { ...SEARCH_TOOL, meta: { secret: 'x' }, annotations: {} }
    const service = createMcpRuntimeService({
      connect: async () => connection({ tools: [withMeta] }),
      toolCatalogCache: cache,
    })
    const gatewayOnly = snapshot()
    await service.executeGateway(gatewayOnly, { operation: 'list' })
    const direct = snapshot({ revision: 'direct', servers: [directServer()] })
    await service.prepareTurn({ sessionId: 'session-1', snapshot: direct })
    await service.listDirectTools(direct)

    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce())
    expect(write).toHaveBeenCalledWith(expect.anything(), [SEARCH_TOOL])
    expect(server().definition.directTools).toBeUndefined()
  })
})
