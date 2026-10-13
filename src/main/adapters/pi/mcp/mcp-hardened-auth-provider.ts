import type { McpServerEntry } from '@earendil-works/pi-coding-agent'
import type { AuthProvider } from '@earendil-works/pi-mcp'
import { getOpenWaggleMcpCredentials } from './openwaggle-mcp-credentials'
import { mcpOAuthUrl } from './pi-mcp-server-oauth'

type SettlingAuthProvider = AuthProvider & { readonly settled?: () => Promise<void> }

/**
 * Pi's auth provider refreshes a token that is about to expire before the request, with
 * `globalThis.fetch`, outside OpenWaggle's hardened fetch (pinned DNS, bounded bodies, public
 * HTTPS for hosts other than the server). This provider sends the stored token as it is; when it
 * has expired, the server's 401 makes Pi refresh it through the fetch the transport hands to
 * `onUnauthorized`, which is the hardened one. One extra round trip per expiry.
 */
export function withHardenedTokenRefresh(
  provider: SettlingAuthProvider,
  storedToken: () => Promise<string | undefined>,
): SettlingAuthProvider {
  return {
    token: async () => {
      await provider.settled?.()
      return storedToken()
    },
    ...(provider.onUnauthorized
      ? { onUnauthorized: (context) => provider.onUnauthorized?.(context) ?? Promise.resolve() }
      : {}),
    ...(provider.settled ? { settled: () => provider.settled?.() ?? Promise.resolve() } : {}),
  }
}

/** `withHardenedTokenRefresh` for a configured server, reading its token from the sign-in store. */
export function hardenedMcpAuthProvider(
  entry: McpServerEntry,
  provider: AuthProvider | undefined,
): AuthProvider | undefined {
  const url = mcpOAuthUrl(entry)
  if (!provider || !url) return provider
  return withHardenedTokenRefresh(provider, async () => {
    const state = await getOpenWaggleMcpCredentials().forServer(entry.name, url).load()
    return state?.tokens?.access_token
  })
}
