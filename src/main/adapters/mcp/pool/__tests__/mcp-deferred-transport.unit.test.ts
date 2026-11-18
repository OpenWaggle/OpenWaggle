import { describe, expect, it } from 'vitest'
import { DeferredTransport } from '../mcp-deferred-transport'
import { FakeUpstream } from './fake-upstream'

describe('DeferredTransport', () => {
  it('closes the transport it was creating when closed during start', async () => {
    const inner = new FakeUpstream()
    let created: (transport: FakeUpstream) => void = () => {}
    const transport = new DeferredTransport(
      () => new Promise<FakeUpstream>((resolve) => (created = resolve)),
    )

    const starting = transport.start()
    await transport.close()
    created(inner)

    await expect(starting).rejects.toThrow('closed while starting')
    expect(inner.closed).toBe(true)
    expect(inner.started).toBe(0)
  })

  it('reports the error a wrapped fetch saw instead of the one the SDK made of it', async () => {
    const inner = new FakeUpstream()
    inner.failStart = new Error('SSE error: Non-200 status code (401)')
    const signIn = new Error('sign in')
    signIn.name = 'McpAuthRequiredError'
    const transport = new DeferredTransport(
      async () => inner,
      () => signIn,
    )

    await expect(transport.start()).rejects.toBe(signIn)
  })
})
