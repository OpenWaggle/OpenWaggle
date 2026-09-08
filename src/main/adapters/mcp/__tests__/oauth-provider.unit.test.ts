import { createServer, type Server } from 'node:http'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { fromAny } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn() }))

vi.mock('@modelcontextprotocol/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@modelcontextprotocol/client')>()),
  auth: mocks.auth,
}))

import {
  assertSafeMcpOAuthAuthorizationUrl,
  authorizeMcpServer,
  createOpenWaggleOAuthProvider,
  type McpOAuthVault,
} from '../oauth-provider'

interface TestOAuthProvider {
  readonly redirectUrl: URL
  readonly state: () => Promise<string>
  readonly redirectToAuthorization: (url: URL) => Promise<void>
}

interface TestAuthOptions {
  readonly authorizationCode?: string
  readonly fetchFn: typeof fetch
  readonly serverUrl: URL
}

function memoryVault(): McpOAuthVault {
  const values = new Map<string, string>()
  return {
    resolve: async (name) => {
      const value = values.get(name)
      if (value === undefined) throw new Error(`${name} was not found`)
      return value
    },
    set: async (name, value) => values.set(name, value),
    remove: async (name) => values.delete(name),
  }
}

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind.')
  return new URL(`http://127.0.0.1:${String(address.port)}/mcp`)
}

const openServers: Server[] = []

afterEach(async () => {
  mocks.auth.mockReset()
  await Promise.all(
    openServers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
})

describe('MCP OAuth safety', () => {
  it.each([
    ['file:///tmp/token', 'require https'],
    ['http://auth.example/authorize', 'require https'],
    ['https://untrusted.example/authorize', 'not allowlisted'],
  ])('rejects unsafe browser authorization URL %s', (url, expectedMessage) => {
    expect(() =>
      assertSafeMcpOAuthAuthorizationUrl(new URL(url), {
        url: 'https://mcp.example/mcp',
        auth: { type: 'oauth' },
        security: { oauthDomains: ['auth.example'] },
      }),
    ).toThrow(expectedMessage)
  })

  it('allows HTTPS OAuth grants and exact loopback HTTP authorization', () => {
    expect(() =>
      assertSafeMcpOAuthAuthorizationUrl(new URL('https://login.auth.example/authorize'), {
        url: 'https://mcp.example/mcp',
        auth: { type: 'oauth' },
        security: { oauthDomains: ['*.auth.example'] },
      }),
    ).not.toThrow()
    expect(() =>
      assertSafeMcpOAuthAuthorizationUrl(new URL('http://127.0.0.1:4567/authorize'), {
        url: 'http://127.0.0.1:4567/mcp',
        auth: { type: 'oauth' },
      }),
    ).not.toThrow()
  })

  it('ignores a forged callback and waits for the callback carrying the saved state', async () => {
    let callbackRequest: Promise<readonly [number, number]> | undefined
    mocks.auth.mockImplementation(async (...arguments_: unknown[]) => {
      const provider = fromAny<TestOAuthProvider, unknown>(arguments_[0])
      const options = fromAny<TestAuthOptions, unknown>(arguments_[1])
      if (options.authorizationCode) {
        expect(options.authorizationCode).toBe('valid-code')
        return 'AUTHORIZED'
      }
      const state = await provider.state()
      const callbackUrl = provider.redirectUrl
      await provider.redirectToAuthorization(
        new URL(`https://auth.example/authorize?state=${encodeURIComponent(state)}`),
      )
      callbackRequest = (async () => {
        const forged = await fetch(new URL('/oauth/callback?code=forged&state=wrong', callbackUrl))
        const valid = await fetch(
          new URL(
            `/oauth/callback?code=valid-code&state=${encodeURIComponent(state)}`,
            callbackUrl,
          ),
        )
        return [forged.status, valid.status] as const
      })()
      return 'REDIRECT'
    })

    await expect(
      authorizeMcpServer({
        instanceId: 'oauth-test',
        definition: {
          url: 'https://mcp.example/mcp',
          auth: { type: 'oauth' },
          security: { oauthDomains: ['auth.example'] },
        },
        vault: memoryVault(),
        openExternal: async () => undefined,
      }),
    ).resolves.toEqual({ authorized: true, browserOpened: true })
    await expect(callbackRequest).resolves.toEqual([400, 200])
  })

  it('never surfaces attacker-controlled OAuth callback error text', async () => {
    const attackerDescription = `denied\r\nFORGED LOG\u0000${'x'.repeat(8_192)}`
    let callbackRequest: Promise<Response> | undefined
    mocks.auth.mockImplementation(async (...arguments_: unknown[]) => {
      const provider = fromAny<TestOAuthProvider, unknown>(arguments_[0])
      const options = fromAny<TestAuthOptions, unknown>(arguments_[1])
      expect(options.authorizationCode).toBeUndefined()
      const state = await provider.state()
      await provider.redirectToAuthorization(
        new URL(`https://auth.example/authorize?state=${encodeURIComponent(state)}`),
      )
      const callbackUrl = new URL('/oauth/callback', provider.redirectUrl)
      callbackUrl.searchParams.set('state', state)
      callbackUrl.searchParams.set('error', 'attacker_error')
      callbackUrl.searchParams.set('error_description', attackerDescription)
      callbackRequest = fetch(callbackUrl)
      return 'REDIRECT'
    })

    const authorization = authorizeMcpServer({
      instanceId: 'oauth-error-test',
      definition: {
        url: 'https://mcp.example/mcp',
        auth: { type: 'oauth' },
        security: { oauthDomains: ['auth.example'] },
      },
      vault: memoryVault(),
      openExternal: async () => undefined,
    })

    await expect(authorization).rejects.toThrow('MCP OAuth authorization failed.')
    await expect(callbackRequest).resolves.toMatchObject({ status: 200 })
    await authorization.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).not.toContain('attacker_error')
      expect(message).not.toContain('FORGED LOG')
      expect(message).not.toContain('x'.repeat(128))
    })
    expect(mocks.auth).toHaveBeenCalledOnce()
  })

  it('accepts only the state generated by the current authorization flow and consumes it', async () => {
    const vault = memoryVault()
    const definition = {
      url: 'https://mcp.example/mcp',
      auth: { type: 'oauth' as const },
      security: { oauthDomains: ['auth.example'] },
    }
    const previous = createOpenWaggleOAuthProvider({
      instanceId: 'oauth-state-test',
      definition,
      redirectUrl: new URL('http://127.0.0.1:1234/oauth/callback'),
      vault,
      onRedirect: async () => undefined,
    })
    const staleState = await previous.state()
    const current = createOpenWaggleOAuthProvider({
      instanceId: 'oauth-state-test',
      definition,
      redirectUrl: new URL('http://127.0.0.1:5678/oauth/callback'),
      vault,
      onRedirect: async () => undefined,
    })

    await expect(current.assertCallbackState(staleState)).rejects.toThrow(
      'did not match the authorization request',
    )
    const currentState = await current.state()
    await expect(current.assertCallbackState(currentState)).resolves.toBeUndefined()
    await expect(current.assertCallbackState(currentState)).rejects.toThrow(
      'did not match the authorization request',
    )
  })

  it('caps OAuth discovery responses before the SDK parses them', async () => {
    const responseBody = 'x'.repeat(MCP_CONFIG.MAX_RESULT_BYTES + 1)
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(responseBody)),
      })
      response.end(responseBody)
    })
    openServers.push(server)
    const serverUrl = await listen(server)
    mocks.auth.mockImplementationOnce(async (...arguments_: unknown[]) => {
      const options = fromAny<TestAuthOptions, unknown>(arguments_[1])
      const response = await options.fetchFn(options.serverUrl)
      await response.text()
      return 'AUTHORIZED'
    })

    await expect(
      authorizeMcpServer({
        instanceId: 'oauth-limit-test',
        definition: {
          url: serverUrl.toString(),
          auth: { type: 'oauth' },
          security: { allowInsecurePrivateNetwork: true },
        },
        vault: memoryVault(),
        openExternal: async () => undefined,
      }),
    ).rejects.toThrow(`${String(MCP_CONFIG.MAX_RESULT_BYTES)} byte safety limit`)
  })
})
