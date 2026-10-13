/**
 * Opening MCP sign-in pages. Both places that open one go through here: the in-Run `/mcp` sign-in
 * (Pi's `openUrl`, which only receives the URL) and the Host-owned sign-in of Settings and the
 * CLI. Each page is checked against the server it signs in to (`checkMcpAuthorizationUrl`) before
 * the browser sees it.
 */
import type { McpServerEntry } from '@earendil-works/pi-coding-agent'
import { openExternal } from '../../../desktop-ui'
import { createLogger } from '../../../logger'
import {
  checkMcpAuthorizationUrl,
  type McpAuthorizationOrigin,
} from '../../mcp/credentials/mcp-authorization-url'
import { getOpenWaggleMcpCredentials } from './openwaggle-mcp-credentials'
import { mcpOAuthUrl } from './pi-mcp-server-oauth'

const logger = createLogger('mcp-sign-in')

type PendingMcpSignIn = McpAuthorizationOrigin & { readonly oauthState?: string }

function configuredMetadataUrl(entry: McpServerEntry) {
  return 'url' in entry.config ? entry.config.oauth?.authServerMetadataUrl : undefined
}

/** What OpenWaggle knows about where `entry` signs in, including what Pi discovered so far. */
export async function mcpAuthorizationOrigin(
  entry: McpServerEntry,
): Promise<PendingMcpSignIn | undefined> {
  const serverUrl = mcpOAuthUrl(entry)
  if (!serverUrl) return undefined
  const state = await getOpenWaggleMcpCredentials().forServer(entry.name, serverUrl).load()
  return {
    serverUrl,
    authServerMetadataUrl: configuredMetadataUrl(entry),
    discovery: state?.discovery,
    ...(state?.oauthState ? { oauthState: state.oauthState } : {}),
  }
}

/**
 * The authorization servers configured or discovered for `entry`: requests to them (discovery,
 * token refresh) may go to a private network or plain HTTP, as requests to the server may.
 */
export async function mcpAuthorizationServerUrls(entry: McpServerEntry): Promise<string[]> {
  const origin = await mcpAuthorizationOrigin(entry).catch(() => undefined)
  if (!origin) return []
  const discovery = origin.discovery
  const metadata = discovery?.authorizationServerMetadata
  return [
    origin.authServerMetadataUrl,
    discovery?.authorizationServerUrl,
    metadata?.issuer,
    metadata?.authorization_endpoint,
    metadata?.token_endpoint,
    metadata?.registration_endpoint,
  ].filter((value): value is string => typeof value === 'string')
}

/**
 * The server a sign-in page belongs to: the one whose pending sign-in issued the page's `state`.
 * Pi saves that state before it asks to open the page.
 */
async function originForPage(href: string, servers: readonly McpServerEntry[]) {
  const state = URL.canParse(href) ? new URL(href).searchParams.get('state') : null
  if (!state) return undefined
  for (const entry of servers) {
    const origin = await mcpAuthorizationOrigin(entry)
    if (origin && origin.oauthState === state) return origin
  }
  return undefined
}

/** Checks a sign-in page and opens it in the browser; rejects without opening anything unsafe. */
export async function openMcpSignInPage(href: string, origin: McpAuthorizationOrigin) {
  const page = checkMcpAuthorizationUrl(href, origin)
  await openExternal(page.href)
  return page
}

/** Pi's `openUrl` for a Run: opens only pages a configured server's sign-in issued. */
export function createRunSignInOpener(servers: () => readonly McpServerEntry[]) {
  return (href: string) => {
    void (async () => {
      const origin = await originForPage(href, servers())
      if (!origin) throw new Error('The MCP sign-in page does not belong to a pending sign-in.')
      await openMcpSignInPage(href, origin)
    })().catch((error: unknown) => {
      logger.warn('Did not open the MCP sign-in page', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }
}

export type McpSignInPageOutcome =
  | { readonly kind: 'opened' }
  /** Safe, but the browser could not be opened (for example during automation): show the URL. */
  | { readonly kind: 'not-opened'; readonly href: string }
  | { readonly kind: 'refused'; readonly error: Error }

/** The Host-owned sign-in's page: checked against `entry`, then opened or handed back. */
export async function showSignInPage(
  entry: McpServerEntry,
  href: string,
): Promise<McpSignInPageOutcome> {
  const origin = await mcpAuthorizationOrigin(entry)
  if (!origin)
    return { kind: 'refused', error: new Error('This server does not sign in with OAuth.') }
  let page: URL
  try {
    page = checkMcpAuthorizationUrl(href, origin)
  } catch (error) {
    return { kind: 'refused', error: error instanceof Error ? error : new Error(String(error)) }
  }
  try {
    await openExternal(page.href)
    return { kind: 'opened' }
  } catch {
    return { kind: 'not-opened', href: page.href }
  }
}
