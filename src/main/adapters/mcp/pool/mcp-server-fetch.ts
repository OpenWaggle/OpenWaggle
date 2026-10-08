import { createSecureMcpFetch, type SecureMcpFetch } from '../runtime/secure-fetch'

/** pi-mcp's limit for one message; HTTP bodies and each SSE event are bounded the same way. */
export const MCP_MAX_MESSAGE_BYTES = 16 * 1024 * 1024

export type McpServerFetch = ((
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>) & { readonly close: () => Promise<void> }

function requestUrl(input: string | URL | Request) {
  if (typeof input === 'string') return new URL(input)
  if (input instanceof URL) return input
  return new URL(input.url)
}

export interface McpServerFetchOptions {
  /**
   * URLs of the authorization servers configured or discovered for this server (Pi's
   * `oauth.authServerMetadataUrl`, the saved discovery). Read on every request, since a sign-in
   * can discover them after the transport was created.
   */
  readonly authorizationServers?: () => readonly string[] | Promise<readonly string[]>
}

function hostOf(value: string) {
  return URL.canParse(value) ? new URL(value).host : undefined
}

/**
 * The fetch an HTTP MCP transport uses. Every request resolves its host once and connects to
 * that address (no DNS rebinding between check and connect), and bodies and SSE events are
 * bounded. The server the user configured, and the authorization servers configured or
 * discovered for it, may be plain HTTP or on a private network, as in Pi; any other host must be
 * public HTTPS, and a redirect may not move a request to another host.
 */
export function createMcpServerFetch(
  serverUrl: string,
  options: McpServerFetchOptions = {},
): McpServerFetch {
  const base = new URL(serverUrl)
  const own = createSecureMcpFetch({
    baseUrl: base,
    allowInsecurePrivateNetwork: true,
    allowPlainHttp: true,
    maxResponseBytes: MCP_MAX_MESSAGE_BYTES,
  })
  const others = new Map<string, SecureMcpFetch>()
  const isAuthorizationServer = async (url: URL) =>
    (await (options.authorizationServers?.() ?? [])).some((value) => hostOf(value) === url.host)
  const fetchFor = async (url: URL) => {
    if (url.host === base.host) return own
    const trusted = await isAuthorizationServer(url)
    const key = `${trusted ? 'trusted' : 'public'} ${url.origin}`
    const existing = others.get(key)
    if (existing) return existing
    const created = createSecureMcpFetch({
      baseUrl: url,
      maxResponseBytes: MCP_MAX_MESSAGE_BYTES,
      ...(trusted ? { allowInsecurePrivateNetwork: true, allowPlainHttp: true } : {}),
    })
    others.set(key, created)
    return created
  }
  return Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input)
      return (await fetchFor(url))(url, {
        ...(input instanceof Request
          ? { method: input.method, headers: input.headers, body: input.body }
          : {}),
        ...init,
      })
    },
    {
      async close() {
        await Promise.all([own.close(), ...[...others.values()].map((fetch) => fetch.close())])
        others.clear()
      },
    },
  )
}
