import path from 'node:path'
import { McpOAuthCredentialStore } from '@earendil-works/pi-coding-agent'
import { safeStorage } from 'electron'
import { createLogger } from '../../../logger'
import {
  mcpBuildStateDirectory,
  sharedMcpStateDirectory,
} from '../../mcp/credentials/mcp-build-state-paths'
import { writeMigratedOAuthState } from '../../mcp/credentials/mcp-migrated-oauth-state'
import { createMcpOAuthStateBackend } from '../../mcp/credentials/mcp-oauth-state-backend'
import { getPiAgentDir } from '../pi-provider-catalog'

const logger = createLogger('mcp-credentials')

const OAUTH_STORE_FILE_NAME = 'oauth-states.json'

let credentials: McpOAuthCredentialStore | undefined
let backend: ReturnType<typeof createMcpOAuthStateBackend> | undefined

/**
 * The OAuth state store every Pi MCP extension in the Host shares: OpenWaggle's encrypted store
 * first, Pi's `mcp-auth.json` read as a fallback and never written.
 */
function getBackend() {
  backend ??= createMcpOAuthStateBackend({
    piAuthPath: path.join(getPiAgentDir(), 'mcp-auth.json'),
    storePath: path.join(mcpBuildStateDirectory(), OAUTH_STORE_FILE_NAME),
    legacyStorePath: path.join(sharedMcpStateDirectory(), OAUTH_STORE_FILE_NAME),
    encryption: safeStorage,
    onWarning: (message, context) => logger.warn(message, context),
  })
  return backend
}

export function getOpenWaggleMcpCredentials() {
  credentials ??= new McpOAuthCredentialStore(
    getBackend(),
    path.join(mcpBuildStateDirectory(), 'locks'),
  )
  return credentials
}

/**
 * Stores one server's state under Pi's key, for the migration of pre-ADR-0051 sign-ins. False,
 * writing nothing, when the key already has a sign-in (OpenWaggle's or Pi's CLI's). Throws when
 * it could only be kept in memory, so the migration tries again.
 */
export function writeOpenWaggleMcpOAuthState(key: string, state: unknown) {
  return writeMigratedOAuthState(getBackend(), key, state)
}

/** Where server log notifications are appended; OpenWaggle keeps its own file. */
export function openWaggleMcpLogPath() {
  return path.join(sharedMcpStateDirectory(), 'mcp.log')
}
