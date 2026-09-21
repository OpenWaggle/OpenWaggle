import { createServer } from 'node:http'
import { type AuthProvider, auth } from '@modelcontextprotocol/client'
import { MCP_CONFIG } from '@shared/constants/mcp'
import type { McpServerDefinition } from '@shared/types/mcp'
import { mcpOAuthVaultKey } from '../../domain/mcp/oauth-vault-key'
import { type McpOAuthVault, OpenWaggleOAuthProvider } from './oauth-vault-provider'
import {
  assertSecureMcpProtocol,
  createSecureMcpFetch,
  isAllowedMcpHostname,
  normalizeMcpAllowedHosts,
} from './runtime/secure-fetch'

const OAUTH_CALLBACK_TIMEOUT_MS = 10 * 60 * 1_000
const HTTP_OK = 200
const HTTP_BAD_REQUEST = 400
const HTTP_NOT_FOUND = 404
const HTTP_SERVICE_UNAVAILABLE = 503

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('MCP OAuth authorization was cancelled.')
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError(signal)
}

async function listenForOAuthCallback(signal?: AbortSignal) {
  throwIfAborted(signal)
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
  let validateState: ((state: string | null) => Promise<void>) | undefined
  let stopWaiting: () => void = () => undefined
  const callback = new Promise<URLSearchParams>((resolve, reject) => {
    let settled = false
    const finish = (operation: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      operation()
    }
    const onAbort = () => finish(() => resolve(new URLSearchParams()))
    const timeout = setTimeout(() => {
      finish(() => reject(new Error('MCP OAuth authorization timed out after ten minutes.')))
    }, OAUTH_CALLBACK_TIMEOUT_MS)
    signal?.addEventListener('abort', onAbort, { once: true })
    stopWaiting = onAbort
    server.on('request', (request, response) => {
      void (async () => {
        const url = new URL(request.url ?? '/', redirectUrl)
        if (url.pathname !== redirectUrl.pathname) {
          response.writeHead(HTTP_NOT_FOUND).end('Not found')
          return
        }
        if (!validateState) {
          response.writeHead(HTTP_SERVICE_UNAVAILABLE).end('Authorization is not ready')
          return
        }
        try {
          await validateState(url.searchParams.get('state'))
        } catch {
          response.writeHead(HTTP_BAD_REQUEST, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
          })
          response.end('Invalid OAuth callback state')
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
        finish(() => resolve(url.searchParams))
      })().catch((error) => {
        finish(() => reject(error))
      })
    })
    if (signal?.aborted) onAbort()
  })
  void callback.catch(() => undefined)
  return {
    redirectUrl,
    callback,
    validateStateWith: (validator: (state: string | null) => Promise<void>) => {
      validateState = validator
    },
    close: () => {
      stopWaiting()
      return new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

export function assertSafeMcpOAuthAuthorizationUrl(url: URL, definition: McpServerDefinition) {
  if (!definition.url) throw new Error('OAuth authorization requires a remote MCP URL.')
  if (url.username || url.password) {
    throw new Error('MCP OAuth authorization URLs cannot contain credentials.')
  }
  assertSecureMcpProtocol(url, false)
  const serverUrl = new URL(definition.url)
  const allowedHosts = normalizeMcpAllowedHosts([
    serverUrl.hostname,
    ...(definition.security?.oauthDomains ?? []),
  ])
  if (!isAllowedMcpHostname(allowedHosts, url.hostname)) {
    throw new Error(`MCP OAuth authorization host is not allowlisted: ${url.hostname}.`)
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
    onRedirect: async (url) => {
      assertSafeMcpOAuthAuthorizationUrl(url, input.definition)
      await input.onRedirect(url)
    },
  })
}

export async function authorizeMcpServer(input: {
  readonly instanceId: string
  readonly definition: McpServerDefinition
  readonly vault: McpOAuthVault
  readonly openExternal: (url: string) => Promise<void>
  readonly signal?: AbortSignal
}) {
  if (!input.definition.url) throw new Error('OAuth authorization requires a remote MCP URL.')
  if (input.definition.auth?.type !== 'oauth') {
    throw new Error('This MCP server is not configured for OAuth.')
  }
  const callbackServer = await listenForOAuthCallback(input.signal)
  const provider = createOpenWaggleOAuthProvider({
    ...input,
    redirectUrl: callbackServer.redirectUrl,
    onRedirect: (url) => {
      throwIfAborted(input.signal)
      return input.openExternal(url.toString())
    },
  })
  callbackServer.validateStateWith((state) => provider.assertCallbackState(state))
  const serverUrl = new URL(input.definition.url)
  const fetchFn = createSecureMcpFetch({
    baseUrl: serverUrl,
    allowedDomains: input.definition.security?.oauthDomains,
    allowInsecurePrivateNetwork: input.definition.security?.allowInsecurePrivateNetwork,
    maxResponseBytes: MCP_CONFIG.MAX_RESULT_BYTES,
  })
  const cancellableFetch: typeof fetchFn = Object.assign(
    (url: Parameters<typeof fetchFn>[0], init?: Parameters<typeof fetchFn>[1]) =>
      fetchFn(url, {
        ...init,
        ...(input.signal
          ? {
              signal: init?.signal ? AbortSignal.any([init.signal, input.signal]) : input.signal,
            }
          : {}),
      }),
    { close: fetchFn.close },
  )

  try {
    throwIfAborted(input.signal)
    const first = await auth(provider, {
      serverUrl,
      scope: input.definition.auth.scopes?.join(' '),
      fetchFn: cancellableFetch,
    })
    if (first === 'AUTHORIZED') return { authorized: true, browserOpened: false }
    const callback = await callbackServer.callback
    throwIfAborted(input.signal)
    if (callback.has('error')) throw new Error('MCP OAuth authorization failed.')
    const code = callback.get('code')
    if (!code) throw new Error('MCP OAuth callback did not include an authorization code.')
    const result = await auth(provider, {
      serverUrl,
      authorizationCode: code,
      ...(callback.get('iss') ? { iss: callback.get('iss') ?? undefined } : {}),
      scope: input.definition.auth.scopes?.join(' '),
      fetchFn: cancellableFetch,
    })
    if (result !== 'AUTHORIZED') throw new Error('MCP OAuth token exchange did not complete.')
    return { authorized: true, browserOpened: true }
  } finally {
    await Promise.all([callbackServer.close(), fetchFn.close()])
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
  return {
    token: async () => (await provider.tokens())?.access_token,
    onUnauthorized: async () => {
      const oauthFetch = createSecureMcpFetch({
        baseUrl: serverUrl,
        allowedDomains: input.definition.security?.oauthDomains,
        allowInsecurePrivateNetwork: input.definition.security?.allowInsecurePrivateNetwork,
        maxResponseBytes: MCP_CONFIG.MAX_RESULT_BYTES,
      })
      try {
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
      } finally {
        await oauthFetch.close()
      }
    },
  }
}
