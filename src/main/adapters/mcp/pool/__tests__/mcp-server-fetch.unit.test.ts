import { describe, expect, it } from 'vitest'
import { createMcpServerFetch } from '../mcp-server-fetch'

const SERVER = 'https://mcp.internal.example:8443/mcp'
const PRIVATE_TOKEN_ENDPOINT = 'https://10.20.30.40/realms/x/protocol/openid-connect/token'
const PLAIN_TOKEN_ENDPOINT = 'http://10.20.30.40/realms/x/protocol/openid-connect/token'
/** Long enough for the network check to run, short enough to stop the connect attempt. */
const CONNECT_ATTEMPT_MS = 200

async function failureOf(fetch: ReturnType<typeof createMcpServerFetch>, url: string) {
  const error = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(CONNECT_ATTEMPT_MS),
  }).catch((caught: unknown) => caught)
  await fetch.close()
  return error instanceof Error ? error.message : String(error)
}

describe("the fetch of an MCP server's HTTP transport", () => {
  it('refuses a private-network host that is neither the server nor its authorization server', async () => {
    const message = await failureOf(createMcpServerFetch(SERVER), PRIVATE_TOKEN_ENDPOINT)

    expect(message).toMatch(/private|forbidden|not allowed|require/i)
  })

  it.each([
    [
      'configured',
      { authServerMetadataUrl: 'https://10.20.30.40/realms/x/.well-known/openid-configuration' },
    ],
    ['discovered', { discovered: ['https://10.20.30.40/realms/x'] }],
  ])(
    'reaches a private-network authorization server the user %s, also over plain http',
    async (_how, hosts) => {
      const authorizationServers = () => [
        ...('authServerMetadataUrl' in hosts ? [hosts.authServerMetadataUrl] : []),
        ...('discovered' in hosts ? hosts.discovered : []),
      ]

      for (const url of [PRIVATE_TOKEN_ENDPOINT, PLAIN_TOKEN_ENDPOINT]) {
        const message = await failureOf(createMcpServerFetch(SERVER, { authorizationServers }), url)
        // The request got past the network check and was only stopped while connecting.
        expect(message).not.toMatch(/private|forbidden|not allowed|require/i)
      }
    },
  )
})
