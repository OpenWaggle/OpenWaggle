import type { McpServer } from '@modelcontextprotocol/server'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import { SESSION_CAPABILITIES, type SessionCapability } from '@shared/types/session-capability'

export {
  assertProjectAllowed,
  canonicalizeExistingProjectPath,
  sessionAllowed,
} from './openwaggle-mcp-workspace-policy'

export const OPENWAGGLE_MCP_SERVE_GRANTS = SESSION_CAPABILITIES

export type OpenWaggleMcpServeGrant = SessionCapability

/**
 * Whose authority an `mcp serve` process holds (#350). `owner` is the local desktop user's,
 * narrowed to the server's grants and scope. `profile` authenticates as a named access profile
 * with its own credential; the Session Host intersects the profile's live policy with the
 * server's grants and scope, so a revoked, unknown, or out-of-scope profile reaches nothing.
 */
export type OpenWaggleMcpServeIdentity =
  | {
      readonly kind: 'owner'
      /** Names the transient caller, e.g. `local-stdio`; not an access profile. */
      readonly label: string
      readonly authorizationCeiling: AgentAuthorizationMode
    }
  | {
      readonly kind: 'profile'
      readonly profile: string
      readonly credential: string
    }

export interface OpenWaggleMcpServeOptions {
  readonly transport: 'stdio' | 'streamable-http'
  readonly httpPort?: number
  readonly bearerToken?: string
  readonly grants: ReadonlySet<OpenWaggleMcpServeGrant>
  readonly workspaceRoots: readonly string[]
  readonly exportRoots?: readonly string[]
  readonly attachmentRoots?: readonly string[]
  readonly sessionIds: ReadonlySet<string>
  /** Immutable session identity bound by the server owner to this server. */
  readonly originSessionId?: string
  readonly identity: OpenWaggleMcpServeIdentity
  readonly userDataRoot: string
  readonly version: string
  readonly stderr?: Pick<NodeJS.WriteStream, 'write'>
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function toolResult(value: unknown, isError = false) {
  const structuredContent = isRecord(value) ? value : { value }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent,
    ...(isError ? { isError: true as const } : {}),
  }
}

export type OpenWaggleMcpServer = McpServer
