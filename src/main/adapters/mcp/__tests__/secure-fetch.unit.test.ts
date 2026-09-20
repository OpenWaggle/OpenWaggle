import { describe, expect, it, vi } from 'vitest'
import {
  createPinnedMcpLookup,
  createSecureMcpFetch,
  validateMcpNetworkTarget,
} from '../runtime/secure-fetch'

const publicLookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 as const }])

describe('secure MCP network policy', () => {
  it('rejects localhost when DNS resolves outside the loopback range', async () => {
    await expect(
      validateMcpNetworkTarget({
        url: new URL('http://localhost/mcp'),
        allowedHosts: new Set(['localhost']),
        allowInsecurePrivateNetwork: false,
        resolveHostname: vi.fn(async () => [{ address: '192.168.1.20', family: 4 as const }]),
      }),
    ).rejects.toThrow('resolved outside loopback')
  })

  it.each(['100.64.0.1', '192.0.2.1', '240.0.0.1', '255.255.255.255', '::ffff:127.0.0.1'])(
    'rejects non-public or IPv4-mapped destination %s',
    async (address) => {
      await expect(
        validateMcpNetworkTarget({
          url: new URL('https://mcp.example/mcp'),
          allowedHosts: new Set(['mcp.example']),
          allowInsecurePrivateNetwork: false,
          resolveHostname: vi.fn(async () => [{ address, family: address.includes(':') ? 6 : 4 }]),
        }),
      ).rejects.toThrow('private or reserved address')
    },
  )

  it('pins connectors to the exact address that passed network validation', async () => {
    const target = await validateMcpNetworkTarget({
      url: new URL('https://mcp.example/mcp'),
      allowedHosts: new Set(['mcp.example']),
      allowInsecurePrivateNetwork: false,
      resolveHostname: publicLookup,
    })
    const lookup = createPinnedMcpLookup(target)

    const addresses = await new Promise<readonly { address: string; family: number }[]>(
      (resolve, reject) => {
        lookup('mcp.example', { all: true }, (error, result) => {
          if (error) reject(error)
          else resolve(Array.isArray(result) ? result : [])
        })
      },
    )

    expect(addresses).toEqual([{ address: '93.184.216.34', family: 4 }])
  })

  it('passes the validated target to the HTTP connector instead of resolving again', async () => {
    const fetchFn = vi.fn(
      async (_url: URL, _init: RequestInit, target: { readonly address: string }) => {
        expect(target.address).toBe('93.184.216.34')
        return new Response('ok')
      },
    )
    const secureFetch = createSecureMcpFetch({
      baseUrl: new URL('https://mcp.example/mcp'),
      fetchFn,
      resolveHostname: publicLookup,
    })

    await secureFetch('https://mcp.example/mcp')

    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it.each(['auth.example', 'https://auth.example'])(
    'strips credentials when a redirect changes to allowlisted domain %s',
    async (allowedDomain) => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 302,
            headers: { location: 'https://auth.example/token' },
          }),
        )
        .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      const secureFetch = createSecureMcpFetch({
        baseUrl: new URL('https://mcp.example/mcp'),
        allowedDomains: [allowedDomain],
        fetchFn,
        resolveHostname: publicLookup,
      })

      await secureFetch('https://mcp.example/mcp', {
        headers: {
          Authorization: 'Bearer secret',
          Cookie: 'session=secret',
          'X-Safe': 'kept',
        },
      })

      const secondInit = fetchFn.mock.calls[1]?.[1]
      const headers = new Headers(secondInit?.headers)
      expect(headers.get('authorization')).toBeNull()
      expect(headers.get('cookie')).toBeNull()
      expect(headers.get('x-safe')).toBe('kept')
    },
  )

  it('accepts a granted wildcard origin only for its subdomains', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://login.auth.example/token' },
        }),
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    const secureFetch = createSecureMcpFetch({
      baseUrl: new URL('https://mcp.example/mcp'),
      allowedDomains: ['https://*.auth.example'],
      fetchFn,
      resolveHostname: publicLookup,
    })

    await expect(secureFetch('https://mcp.example/mcp')).resolves.toBeInstanceOf(Response)
  })

  it('preserves credentials on same-origin redirects', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: '/next' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    const secureFetch = createSecureMcpFetch({
      baseUrl: new URL('https://mcp.example/mcp'),
      fetchFn,
      resolveHostname: publicLookup,
    })

    await secureFetch('https://mcp.example/mcp', {
      headers: { Authorization: 'Bearer retained' },
    })

    expect(new Headers(fetchFn.mock.calls[1]?.[1]?.headers).get('authorization')).toBe(
      'Bearer retained',
    )
  })

  it('allows a public cross-host redirect when the caller opts in', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://cdn.example/image.png' },
        }),
      )
      .mockResolvedValueOnce(new Response('image', { status: 200 }))
    const secureFetch = createSecureMcpFetch({
      baseUrl: new URL('https://images.example/image.png'),
      allowPublicRedirects: true,
      fetchFn,
      resolveHostname: publicLookup,
    })

    await expect(secureFetch('https://images.example/image.png')).resolves.toBeInstanceOf(Response)
    expect(fetchFn.mock.calls[1]?.[0]).toEqual(new URL('https://cdn.example/image.png'))
  })

  it('still rejects private redirect targets when public redirects are enabled', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'https://private.example/image.png' },
      }),
    )
    const secureFetch = createSecureMcpFetch({
      baseUrl: new URL('https://images.example/image.png'),
      allowPublicRedirects: true,
      fetchFn,
      resolveHostname: vi.fn(async (hostname) => [
        {
          address: hostname === 'private.example' ? '192.168.1.20' : '93.184.216.34',
          family: 4 as const,
        },
      ]),
    })

    await expect(secureFetch('https://images.example/image.png')).rejects.toThrow(
      'private or reserved address',
    )
    expect(fetchFn).toHaveBeenCalledOnce()
  })
})
