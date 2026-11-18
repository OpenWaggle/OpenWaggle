import { describe, expect, it } from 'vitest'
import { searchMcpRegistry } from '../registry-client'

function registryAnswering(payload: unknown) {
  return async () => new Response(JSON.stringify(payload), { status: 200 })
}

const OFFICIAL = 'io.modelcontextprotocol.registry/official'

describe('searchMcpRegistry', () => {
  it('reads wrapped and bare servers, keeps the latest versions, and skips nameless ones', async () => {
    const servers = await searchMcpRegistry({
      query: 'weather',
      fetchResource: registryAnswering({
        servers: [
          {
            server: {
              name: 'io.github.acme/weather',
              version: '2.0.0',
              title: 'Weather',
              repository: { url: 'https://github.com/acme/weather' },
            },
            _meta: { [OFFICIAL]: { isLatest: true } },
          },
          { server: { name: 'io.github.acme/weather', version: '1.0.0' } },
          {
            name: 'io.github.acme/bare',
            version: '1.0.0',
            _meta: { [OFFICIAL]: { isLatest: true } },
          },
          { server: { name: '  ', version: '1.0.0' }, _meta: { [OFFICIAL]: { isLatest: true } } },
          'not a server',
        ],
      }),
    })

    expect(
      servers.map(({ name, version, title, repositoryUrl }) => ({
        name,
        version,
        title,
        repositoryUrl,
      })),
    ).toEqual([
      {
        name: 'io.github.acme/weather',
        version: '2.0.0',
        title: 'Weather',
        repositoryUrl: 'https://github.com/acme/weather',
      },
      { name: 'io.github.acme/bare', version: '1.0.0', title: undefined, repositoryUrl: undefined },
    ])
  })

  it('refuses an answer without a server list', async () => {
    await expect(
      searchMcpRegistry({ query: 'weather', fetchResource: registryAnswering({ servers: {} }) }),
    ).rejects.toThrow('MCP registry returned an invalid server list.')
  })
})
