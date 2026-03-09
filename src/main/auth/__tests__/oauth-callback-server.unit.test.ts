import { afterEach, describe, expect, it } from 'vitest'
import { createCallbackServer } from '../oauth-callback-server'

type CallbackServer = Awaited<ReturnType<typeof createCallbackServer>>

// Track servers for cleanup
const servers: CallbackServer[] = []

afterEach(() => {
  for (const server of servers) {
    server.close()
  }
  servers.length = 0
})

describe('OAuth Callback Server', () => {
  it('starts on an ephemeral port when no port specified', async () => {
    const server = await createCallbackServer()
    servers.push(server)
    expect(server.port).toBeGreaterThan(0)
  })

  it('starts on an ephemeral port with port 0', async () => {
    const server = await createCallbackServer({ port: 0 })
    servers.push(server)
    expect(server.port).toBeGreaterThan(0)
  })

  it('resolves waitForCallback when code is received', async () => {
    const server = await createCallbackServer()
    servers.push(server)

    const callbackPromise = server.waitForCallback()

    // Send a request with a code
    const response = await fetch(`http://127.0.0.1:${server.port}/?code=test-code&state=test-state`)
    expect(response.ok).toBe(true)

    const result = await callbackPromise
    expect(result.code).toBe('test-code')
    expect(result.state).toBe('test-state')
  })

  it('returns 400 when no code is provided', async () => {
    const server = await createCallbackServer()
    servers.push(server)

    const response = await fetch(`http://127.0.0.1:${server.port}/?nocode=true`)
    expect(response.status).toBe(400)
  })

  it('handles state parameter being optional', async () => {
    const server = await createCallbackServer()
    servers.push(server)

    const callbackPromise = server.waitForCallback()

    await fetch(`http://127.0.0.1:${server.port}/?code=my-code`)

    const result = await callbackPromise
    expect(result.code).toBe('my-code')
    expect(result.state).toBeUndefined()
  })

  it('close() stops the server gracefully', async () => {
    const server = await createCallbackServer()
    // Should not throw
    server.close()
  })

  it('close() rejects pending waitForCallback', async () => {
    const server = await createCallbackServer()
    servers.push(server)

    const callbackPromise = server.waitForCallback()
    server.close()

    await expect(callbackPromise).rejects.toThrow('OAuth callback server closed')
  })

  it('rejects waitForCallback when OAuth error is returned', async () => {
    const server = await createCallbackServer()
    servers.push(server)

    const callbackPromise = server.waitForCallback()

    // Fire-and-forget: the fetch itself returns 200, but the callback rejects
    fetch(`http://127.0.0.1:${server.port}/?error=access_denied&error_description=User+cancelled`)

    await expect(callbackPromise).rejects.toThrow('OAuth authorization denied: User cancelled')
  })

  it('uses default error description when none provided', async () => {
    const server = await createCallbackServer()
    servers.push(server)

    const callbackPromise = server.waitForCallback()

    // Fire-and-forget: the fetch itself returns 200, but the callback rejects
    fetch(`http://127.0.0.1:${server.port}/?error=server_error`)

    await expect(callbackPromise).rejects.toThrow(
      'OAuth authorization denied: Authorization was denied',
    )
  })
})
