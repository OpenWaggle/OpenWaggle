import type { ExtensionAPI, McpServerEntry } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it } from 'vitest'
import { mcpServerIdentity } from '../../../mcp/pool/mcp-server-identity'
import { forgetMcpAppTools, recordMcpAppTools } from '../mcp-app-registry'
import { registerUnknownMcpAppToolWait } from '../mcp-app-tool-startup-wait'
import { forgetKnownMcpServerStates, recordMcpServerCheck } from '../mcp-server-status-registry'

const SESSION = 'wait-session'
const server: McpServerEntry = { name: 'apps', config: { command: 'apps' }, source: 'test' }

function fakePi() {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>()
  const pi = fromPartial<ExtensionAPI>({
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
      handlers.set(event, handler)
      return () => undefined
    },
  })
  const emit = (event: string) => handlers.get(event)?.({}, { signal: undefined })
  return { pi, emit }
}

afterEach(() => {
  forgetMcpAppTools(SESSION)
  forgetKnownMcpServerStates()
})

describe('first-request wait for servers with unknown App tools (C2)', () => {
  it('waits until the server listed and its App tool is registered', async () => {
    const { pi, emit } = fakePi()
    const registered = new Set<string>()
    registerUnknownMcpAppToolWait(pi, {
      sessionId: SESSION,
      servers: [server],
      waitMs: 5_000,
      registered: (label) => registered.has(label),
    })
    emit('session_start')
    let done = false
    const waiting = Promise.resolve(emit('before_agent_start')).then(() => {
      done = true
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    recordMcpAppTools(SESSION, 'apps', {
      tools: [{ name: 'show', _meta: { ui: { resourceUri: 'ui://apps/show' } } }],
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(done).toBe(false)
    registered.add('apps/show')
    await waiting
    expect(done).toBe(true)
  })

  it('gives up after the bound, and does not wait for known or hidden servers', async () => {
    const { pi, emit } = fakePi()
    registerUnknownMcpAppToolWait(pi, {
      sessionId: SESSION,
      servers: [server, { ...server, name: 'off', config: { command: 'x', exposure: 'hidden' } }],
      waitMs: 30,
      registered: () => false,
    })
    emit('session_start')
    const started = Date.now()
    await emit('before_agent_start')
    expect(Date.now() - started).toBeGreaterThanOrEqual(25)

    // Known (cached catalog says no App tools): no wait.
    const known = fakePi()
    registerUnknownMcpAppToolWait(known.pi, {
      sessionId: SESSION,
      servers: [server],
      cached: () => [],
      waitMs: 5_000,
      registered: () => false,
    })
    known.emit('session_start')
    const quick = Date.now()
    await known.emit('before_agent_start')
    expect(Date.now() - quick).toBeLessThan(25)
  })
})

describe('first-request wait and servers that cannot list (review R5 P2-2)', () => {
  it('stops waiting for a server a check saw failing or signed out since the Run started', async () => {
    const { pi, emit } = fakePi()
    registerUnknownMcpAppToolWait(pi, {
      sessionId: SESSION,
      servers: [server],
      waitMs: 5_000,
      registered: () => false,
    })
    emit('session_start')
    const started = Date.now()
    setTimeout(() => {
      recordMcpServerCheck(mcpServerIdentity(server.name, server.config), {
        name: server.name,
        state: 'needs-sign-in',
        tools: [],
      })
    }, 30)
    await emit('before_agent_start')
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('stops waiting within a poll once the server’s connection fails during the wait', async () => {
    let failed = false
    const { pi, emit } = fakePi()
    registerUnknownMcpAppToolWait(pi, {
      sessionId: SESSION,
      servers: [server],
      waitMs: 5_000,
      registered: () => false,
      failed: () => failed,
    })
    emit('session_start')
    const started = Date.now()
    setTimeout(() => {
      failed = true
    }, 50)
    await emit('before_agent_start')
    expect(Date.now() - started).toBeLessThan(500)
  })
})

/*
 * Review V2 P3-2: the server states are kept by identity for the whole Host, with no project. A
 * failure recorded before the Run (in another project, or before the user fixed the server) made
 * the first request skip the wait, so a server that lists an App tool here was declared only
 * from the second request.
 */
describe('first-request wait and failures recorded before the Run (review V2 P3-2)', () => {
  for (const state of ['failed', 'needs-sign-in'] as const) {
    it(`waits for a server last seen ${state} before the Run, and declares its App tool`, async () => {
      recordMcpServerCheck(
        mcpServerIdentity(server.name, server.config),
        { name: server.name, state, tools: [], error: 'command not found' },
        Date.now() - 60_000,
      )
      const { pi, emit } = fakePi()
      const registered = new Set<string>()
      registerUnknownMcpAppToolWait(pi, {
        sessionId: SESSION,
        servers: [server],
        waitMs: 5_000,
        registered: (label) => registered.has(label),
      })
      emit('session_start')
      let done = false
      const waiting = Promise.resolve(emit('before_agent_start')).then(() => {
        done = true
      })
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(done).toBe(false)

      // This Run's connection lists the App tool, and Pi registers it.
      recordMcpAppTools(SESSION, 'apps', {
        tools: [{ name: 'show', _meta: { ui: { resourceUri: 'ui://apps/show' } } }],
      })
      registered.add('apps/show')
      await waiting
      expect(done).toBe(true)
    })
  }
})
