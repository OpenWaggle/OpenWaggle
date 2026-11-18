import { describe, expect, it } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { isMcpHostDraining } from '../../mcp-host-draining'
import { installSessionHostEventRuntime } from '../session-host-events'

describe('MCP reads during a Session Host drain', () => {
  it("see the Host's drain while its runtime is installed", () => {
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: () => undefined,
    })
    const release = installSessionHostEventRuntime({
      eventHub: new SessionHostEventHub(),
      liveness,
    })
    // Kept from shutting down while the drain is checked.
    const releaseClient = liveness.acquire('client')

    expect(isMcpHostDraining()).toBe(false)
    liveness.requestDrain('upgrade')
    expect(isMcpHostDraining()).toBe(true)
    releaseClient()
    release()
    expect(isMcpHostDraining()).toBe(false)
  })
})
