import { MCP_CONFIG } from '@shared/constants/mcp'
import { Effect, TestClock, TestContext } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { makeMcpRuntimeService } from '../runtime/runtime-service-factory'
import { connection, snapshot } from './mcp-runtime-test-utils'

describe('first-party MCP runtime catalog TTL (Clock)', () => {
  it('serves the cached catalog until the TTL elapses, then re-lists tools', async () => {
    const listTools = vi.fn(async () => [
      {
        name: 'search_private_docs',
        title: 'Search documentation',
        inputSchema: { type: 'object', properties: {} },
      },
    ])
    const connect = vi.fn(async () => ({ ...connection(), listTools }))
    const program = Effect.gen(function* () {
      const service = yield* makeMcpRuntimeService({
        connect,
        createHandleKey: () => Buffer.alloc(32, 7),
      })
      const turn = snapshot()
      yield* service.executeGateway({ snapshot: turn, request: { operation: 'list' } })
      yield* service.executeGateway({ snapshot: turn, request: { operation: 'list' } })
      // Within the TTL: catalog is cached, so tools are not re-listed.
      const listedBeforeExpiry = listTools.mock.calls.length
      yield* TestClock.adjust(`${MCP_CONFIG.CATALOG_CACHE_TTL_MS + 1} millis`)
      yield* service.executeGateway({ snapshot: turn, request: { operation: 'list' } })
      return listedBeforeExpiry
    })
    const listedBeforeExpiry = await Effect.runPromise(
      program.pipe(Effect.provide(TestContext.TestContext)),
    )
    // The connection is pooled (connect once); the catalog TTL controls re-listing.
    expect(connect).toHaveBeenCalledTimes(1)
    expect(listedBeforeExpiry).toBe(1)
    expect(listTools).toHaveBeenCalledTimes(2)
  })
})
