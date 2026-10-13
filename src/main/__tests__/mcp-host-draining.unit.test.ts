import { describe, expect, it } from 'vitest'
import { installMcpHostDrainingProbe, isMcpHostDraining } from '../mcp-host-draining'

describe('whether MCP reads see the Session Host draining', () => {
  it("follows the installed Host's liveness until it is released", () => {
    let draining = false
    const release = installMcpHostDrainingProbe(() => draining)

    expect(isMcpHostDraining()).toBe(false)
    draining = true
    expect(isMcpHostDraining()).toBe(true)
    release()
    // No Host: nothing drains.
    expect(isMcpHostDraining()).toBe(false)
  })
})
