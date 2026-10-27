import type { ExtensionAPI, McpServerEntry } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it } from 'vitest'
import { forgetMcpAppTools, recordMcpAppTools } from '../mcp-app-registry'
import { registerUnknownMcpAppToolWait } from '../mcp-app-tool-startup-wait'

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

afterEach(() => forgetMcpAppTools(SESSION))

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
