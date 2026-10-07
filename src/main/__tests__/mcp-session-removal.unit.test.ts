import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FakeUpstream,
  flush,
  initializeRequest,
} from '../adapters/mcp/pool/__tests__/fake-upstream'
import { mcpSessionConnectionPool } from '../adapters/mcp/pool/mcp-connection-pool-instance'
import { runSessionRemovalHooks } from '../application/session-removal-hooks'
import { installMcpSessionRemoval } from '../mcp-session-removal'

const { forgetSessionMcpSwitch } = vi.hoisted(() => ({
  forgetSessionMcpSwitch: vi.fn(async (_sessionId: string) => undefined),
}))

// The switch is Host database state; `session-mcp-switch.integration.test.ts` covers the store.
vi.mock('../store/session-mcp-switch', () => ({ forgetSessionMcpSwitch }))

afterEach(async () => {
  await mcpSessionConnectionPool.closeAll()
})

async function warmConnection(sessionId: string) {
  const upstream = new FakeUpstream()
  const lease = mcpSessionConnectionPool.lease(sessionId, {
    name: 'fs',
    fingerprint: 'v1',
    open: () => ({ transport: upstream }),
  })
  await lease.start()
  await lease.send(initializeRequest(1))
  await flush()
  await lease.close()
  return upstream
}

describe("removing a Session (archive, delete, a Worker's cleanup)", () => {
  it('closes its MCP connections and forgets that MCP was switched off for it', async () => {
    installMcpSessionRemoval()
    installMcpSessionRemoval()
    const removed = await warmConnection('removed')
    const kept = await warmConnection('kept')

    await Effect.runPromise(runSessionRemovalHooks(SessionId('removed')))

    expect(removed.closed).toBe(true)
    expect(kept.closed).toBe(false)
    expect(mcpSessionConnectionPool.warmSessions()).toEqual(['kept'])
    expect(forgetSessionMcpSwitch).toHaveBeenCalledWith('removed')
    expect(forgetSessionMcpSwitch).not.toHaveBeenCalledWith('kept')
  })
})
