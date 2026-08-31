import { createServer } from 'node:http'
import { type AuthProvider, auth } from '@modelcontextprotocol/client'
import type { McpServerDefinition } from '@shared/types/mcp'
import { mcpOAuthVaultKey } from '../../domain/mcp/oauth-vault-key'
import { type McpOAuthVault, OpenWaggleOAuthProvider } from './oauth-vault-provider'
import { createSecureMcpFetch } from './runtime/secure-fetch'

const OAUTH_CALLBACK_TIMEOUT_MS = 10 * 60 * 1_000
const HTTP_OK = 200
const HTTP_NOT_FOUND = 404

async function listenForOAuthCallback() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw new Error('MCP OAuth could not determine its loopback callback address.')
  }
  const redirectUrl = new URL(`http://127.0.0.1:${String(address.port)}/oauth/callback`)
  const callback = new Promise<URLSearchParams>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('MCP OAuth authorization timed out after ten minutes.'))
    }, OAUTH_CALLBACK_TIMEOUT_MS)
    server.on('request', (request, response) => {
      try {
        const url = new URL(request.url ?? '/', redirectUrl)
        if (url.pathname !== redirectUrl.pathname) {
          response.writeHead(HTTP_NOT_FOUND).end('Not found')
          return
        }
        response.writeHead(HTTP_OK, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
        })
        response.end(
          '<!doctype html><meta charset="utf-8"><title>OpenWaggle authorized</title><style>body{font:16px system-ui;max-width:42rem;margin:5rem auto;padding:1rem;background:#141619;color:#f4f4f5}</style><h1>Authorization received</h1><p>You can return to OpenWaggle.</p>',
        )
        clearTimeout(timeout)
        resolve(url.searchParams)
      } catch (error) {
        clearTimeout(timeout)
        reject(error)
      }
    })
  })
  return {
    redirectUrl,
    callback,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

export function createOpenWaggleOAuthProvider(input: {
  readonly instanceId: string
  readonly redirectUrl: URL
  readonly definition: McpServerDefinition
  readonly vault: McpOAuthVault
  readonly onRedirect: (url: URL) => void | Promise<void>
}) {
  return new OpenWaggleOAuthProvider({
    instanceId: input.instanceId,
    redirectUrl: input.redirectUrl,
    vault: input.vault,
    scopes: input.definition.auth?.scopes,
    clientMetadataUrl: input.definition.auth?.clientMetadataUrl,
    onRedirect: input.onRedirect,
  })
}

export async function authorizeMcpServer(input: {
  readonly instanceId: string
  readonly definition: McpServerDefinition
  readonly vault: McpOAuthVault
  readonly openExternal: (url: string) => Promise<void>
}) {
  if (!input.definition.url) throw new Error('OAuth authorization requires a remote MCP URL.')
  if (input.definition.auth?.type !== 'oauth') {
    throw new Error('This MCP server is not configured for OAuth.')
  }
  const callbackServer = await listenForOAuthCallback()
  const provider = createOpenWaggleOAuthProvider({
    ...input,
    redirectUrl: callbackServer.redirectUrl,
    onRedirect: (url) => input.openExternal(url.toString()),
  })
  const serverUrl = new URL(input.definition.url)
  const fetchFn = createSecureMcpFetch({
    baseUrl: serverUrl,
    allowedDomains: input.definition.security?.oauthDomains,
    allowInsecurePrivateNetwork: input.definition.security?.allowInsecurePrivateNetwork,
  })

  try {
    const first = await auth(provider, {
      serverUrl,
      scope: input.definition.auth.scopes?.join(' '),
      fetchFn,
    })
    if (first === 'AUTHORIZED') return { authorized: true, browserOpened: false }
    const callback = await callbackServer.callback
    const oauthError = callback.get('error')
    if (oauthError) {
      throw new Error(
        `MCP OAuth authorization failed: ${oauthError}${callback.get('error_description') ? ` — ${callback.get('error_description')}` : ''}.`,
      )
    }
    await provider.assertCallbackState(callback.get('state'))
    const code = callback.get('code')
    if (!code) throw new Error('MCP OAuth callback did not include an authorization code.')
    const result = await auth(provider, {
      serverUrl,
      authorizationCode: code,
      ...(callback.get('iss') ? { iss: callback.get('iss') ?? undefined } : {}),
      scope: input.definition.auth.scopes?.join(' '),
      fetchFn,
    })
    if (result !== 'AUTHORIZED') throw new Error('MCP OAuth token exchange did not complete.')
    return { authorized: true, browserOpened: true }
  } finally {
    await callbackServer.close()
  }
}

export async function logoutMcpOAuth(input: {
  readonly instanceId: string
  readonly vault: McpOAuthVault
}) {
  await input.vault.remove(mcpOAuthVaultKey(input.instanceId))
}

export type { McpOAuthVault } from './oauth-vault-provider'
export { OpenWaggleOAuthProvider } from './oauth-vault-provider'

export function createOpenWaggleRuntimeAuthProvider(input: {
  readonly instanceId: string
  readonly definition: McpServerDefinition
  readonly vault: McpOAuthVault
}): AuthProvider {
  if (!input.definition.url) throw new Error('OAuth requires a remote MCP URL.')
  const serverUrl = new URL(input.definition.url)
  const provider = createOpenWaggleOAuthProvider({
    ...input,
    redirectUrl: new URL('http://127.0.0.1/oauth/callback'),
    onRedirect: () => {
      throw new Error(
        'MCP authorization requires user action. Run `openwaggle mcp auth <server>` or use Settings → MCP.',
      )
    },
  })
  const oauthFetch = createSecureMcpFetch({
    baseUrl: serverUrl,
    allowedDomains: input.definition.security?.oauthDomains,
    allowInsecurePrivateNetwork: input.definition.security?.allowInsecurePrivateNetwork,
  })
  return {
    token: async () => (await provider.tokens())?.access_token,
    onUnauthorized: async () => {
      const result = await auth(provider, {
        serverUrl,
        scope: input.definition.auth?.scopes?.join(' '),
        fetchFn: oauthFetch,
      })
      if (result !== 'AUTHORIZED') {
        throw new Error(
          'MCP authorization requires user action. Run `openwaggle mcp auth <server>` or use Settings → MCP.',
        )
      }
    },
  }
}
