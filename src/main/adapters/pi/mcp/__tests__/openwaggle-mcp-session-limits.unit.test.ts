import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { openWaggleMcpConnectionHooks } from '../mcp-session-context'
import { createOpenWaggleMcpExtensions, openWaggleMcpTransport } from '../openwaggle-mcp-extensions'

function pool() {
  return fromPartial<Parameters<typeof createOpenWaggleMcpExtensions>[0]['pool']>({
    lease: vi.fn(() => fromPartial({})),
  })
}

const registered = {
  name: 'from-extension',
  config: { command: 'ext-mcp' },
  source: '/ext/index.ts',
  scope: 'extension' as const,
}

describe('servers Pi extensions register', () => {
  it('get no MCP runtime at all in a Session with MCP off', async () => {
    const extensions = await createOpenWaggleMcpExtensions({
      sessionId: 's1',
      projectPath: null,
      pool: pool(),
      sessionMcpEnabled: false,
    })

    expect(extensions).toEqual([])
  })

  it("are refused when the Session's Agent definition does not list them", () => {
    const leases = pool()
    const transport = openWaggleMcpTransport(
      { sessionId: 's1', projectPath: null, pool: leases, serverAllowlist: ['docs'] },
      { transports: new Map() },
    )

    expect(() => transport(registered, '/work', undefined)).toThrow(
      'does not use the MCP server "from-extension"',
    )
    expect(leases.lease).not.toHaveBeenCalled()
  })

  it('may ask for sampling during a Run, like configured servers', async () => {
    const { attachSessionMcpContext } = await import('../mcp-session-context')
    const sample = vi.fn(async () => ({ role: 'assistant' }))
    const detach = attachSessionMcpContext('s1', {
      interactions: fromPartial({ sample }),
      servers: new Map(),
    })
    const hooks = openWaggleMcpConnectionHooks('s1', 'from-extension', 'identity-1')

    await hooks.handleServerRequest?.({
      method: 'sampling/createMessage',
      params: { messages: [], maxTokens: 1 },
      signal: new AbortController().signal,
    })
    detach()

    expect(sample).toHaveBeenCalledWith(
      expect.objectContaining({ serverInstanceId: 'identity-1', serverLabel: 'from-extension' }),
    )
  })
})
