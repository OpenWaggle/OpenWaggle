import { homedir } from 'node:os'
import path from 'node:path'
import { McpOAuthCredentialStore } from '@earendil-works/pi-coding-agent'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { safeStorage } from 'electron'
import { createLogger } from '../../../logger'
import { createMcpOAuthStateBackend } from '../../mcp/credentials/mcp-oauth-state-backend'
import { getPiAgentDir } from '../pi-provider-catalog'

const logger = createLogger('mcp-credentials')

let credentials: McpOAuthCredentialStore | undefined
let backend: ReturnType<typeof createMcpOAuthStateBackend> | undefined

function stateDirectory() {
  return path.join(homedir(), ...MCP_CONFIG.GLOBAL_STATE_DIR)
}

/**
 * The OAuth state store every Pi MCP extension in the Host shares: OpenWaggle's encrypted store
 * first, Pi's `mcp-auth.json` read as a fallback and never written.
 */
function getBackend() {
  backend ??= createMcpOAuthStateBackend({
    piAuthPath: path.join(getPiAgentDir(), 'mcp-auth.json'),
    storePath: path.join(stateDirectory(), 'oauth-states.json'),
    encryption: safeStorage,
    onWarning: (message, context) => logger.warn(message, context),
  })
  return backend
}

export function getOpenWaggleMcpCredentials() {
  credentials ??= new McpOAuthCredentialStore(getBackend(), path.join(stateDirectory(), 'locks'))
  return credentials
}

/** Stores one server's state under Pi's key, for the migration of pre-ADR-0048 sign-ins. */
export function writeOpenWaggleMcpOAuthState(key: string, state: unknown) {
  getBackend().withLock((current) => {
    const parsed: unknown = current === undefined ? {} : JSON.parse(current)
    const states = typeof parsed === 'object' && parsed !== null ? { ...parsed } : {}
    return { result: undefined, next: JSON.stringify({ ...states, [key]: state }) }
  })
}

/** Where server log notifications are appended; OpenWaggle keeps its own file. */
export function openWaggleMcpLogPath() {
  return path.join(stateDirectory(), 'mcp.log')
}
