import type { McpServer } from '@modelcontextprotocol/server'
import { SessionId } from '@shared/types/brand'
import { SESSION_CAPABILITIES, type SessionCapability } from '@shared/types/session-capability'
import * as Effect from 'effect/Effect'
import { sessionAllowed } from './openwaggle-mcp-workspace-policy'
import { SessionProjectionRepository } from './ports/session-projection-repository'
import { runAppEffect } from './runtime'

export {
  assertProjectAllowed,
  canonicalizeExistingProjectPath,
  sessionAllowed,
} from './openwaggle-mcp-workspace-policy'

export const OPENWAGGLE_MCP_SERVE_GRANTS = SESSION_CAPABILITIES

export type OpenWaggleMcpServeGrant = SessionCapability

export interface OpenWaggleMcpServeOptions {
  readonly transport: 'stdio' | 'streamable-http'
  readonly httpPort?: number
  readonly bearerToken?: string
  readonly grants: ReadonlySet<OpenWaggleMcpServeGrant>
  readonly workspaceRoots: readonly string[]
  readonly exportRoots?: readonly string[]
  readonly attachmentRoots?: readonly string[]
  readonly sessionIds: ReadonlySet<string>
  /** Immutable session identity bound by the server owner to this caller profile. */
  readonly originSessionId?: string
  readonly profile: string
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

export function requireGrant(options: OpenWaggleMcpServeOptions, grant: OpenWaggleMcpServeGrant) {
  if (!options.grants.has(grant)) {
    throw new Error(
      `The caller profile ${JSON.stringify(options.profile)} lacks ${grant}. Restart with --grant ${grant} after reviewing the requested authority.`,
    )
  }
}

export async function loadGrantedSession(options: OpenWaggleMcpServeOptions, sessionId: string) {
  const session = await runAppEffect(
    Effect.gen(function* () {
      const sessions = yield* SessionProjectionRepository
      return yield* sessions.getOptional(SessionId(sessionId))
    }),
  )
  if (!session || !sessionAllowed(options, session)) {
    throw new Error(`Session ${JSON.stringify(sessionId)} was not found in the granted scope.`)
  }
  return session
}

export type OpenWaggleMcpServer = McpServer
