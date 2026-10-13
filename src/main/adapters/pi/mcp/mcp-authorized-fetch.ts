import { type AuthProvider, McpAuthRequiredError } from '@earendil-works/pi-mcp'

const HTTP_UNAUTHORIZED = 401
const HTTP_FORBIDDEN = 403

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/** A 401, or a 403 that asks for more scope: what pi-mcp hands to the auth provider. */
function needsAuthorization(response: Response) {
  if (response.status === HTTP_UNAUTHORIZED) return true
  if (response.status !== HTTP_FORBIDDEN) return false
  const challenge = response.headers.get('www-authenticate') ?? ''
  return /(?:^|[\s,])error="?insufficient_scope"?/i.test(challenge)
}

export type McpAuthorizedFetch = Fetch & {
  /** The sign-in failure a request ended with, for transports that hide the error they got. */
  readonly authFailure: () => Error | undefined
}

/**
 * Sign-ins for the legacy SSE transport, which knows nothing of pi-mcp's auth provider: each
 * request carries the provider's bearer token, a 401 (or a 403 asking for more scope) is handed to
 * the provider once and the request retried, and a request still refused fails with pi-mcp's
 * `McpAuthRequiredError`, so Pi shows the server as needing sign-in. The same rules as pi-mcp's
 * streamable HTTP transport.
 */
export function createMcpAuthorizedFetch(input: {
  readonly fetch: Fetch
  readonly authProvider: AuthProvider
  readonly serverUrl: URL
}): McpAuthorizedFetch {
  const { authProvider, serverUrl } = input
  let failure: Error | undefined
  const send = async (url: string | URL | Request, init: RequestInit | undefined) => {
    const token = await authProvider.token()
    const headers = new Headers(init?.headers)
    if (token && !headers.has('authorization')) headers.set('Authorization', `Bearer ${token}`)
    const response = await input.fetch(url, { ...init, headers })
    return { response, token }
  }
  const authorizedFetch = async (url: string | URL | Request, init?: RequestInit) => {
    const first = await send(url, init)
    if (!needsAuthorization(first.response)) return first.response
    if (authProvider.onUnauthorized) {
      try {
        await authProvider.onUnauthorized({
          response: first.response,
          serverUrl,
          fetch: (next, nextInit) => input.fetch(next, nextInit),
          ...(first.token ? { token: first.token } : {}),
        })
      } catch (error) {
        // Pi's provider reports a needed sign-in this way (McpOAuthAuthorizationRequiredError).
        failure = error instanceof Error ? error : new Error(String(error))
        throw failure
      } finally {
        await first.response.body?.cancel().catch(() => undefined)
      }
    }
    const retried = authProvider.onUnauthorized ? (await send(url, init)).response : first.response
    if (!needsAuthorization(retried)) return retried
    const body = await retried.text().catch(() => '')
    failure = new McpAuthRequiredError(retried, body)
    throw failure
  }
  return Object.assign(authorizedFetch, { authFailure: () => failure })
}
