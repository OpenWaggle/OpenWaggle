import { decodeUnknownOrThrow } from '@shared/schema'
import { mcpConfigValueSchema } from '@shared/schemas/mcp'
import { SessionId } from '@shared/types/brand'
import type {
  McpAppCatalogResult,
  McpAppToolCallResult,
  McpResourceResult,
} from '@shared/types/mcp-apps'
import { resolveSessionWorkingDir } from '@shared/utils/worktree'
import { Schema } from 'effect'
import * as Effect from 'effect/Effect'
import { McpAppRuntimeService } from '../ports/mcp-app-runtime-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'

/**
 * MCP Apps read their `ui://` resources and call their server's tools over the Session's MCP
 * connection (ADR 0050). `serverInstanceId` is the Session's server name and `serverConfigHash`
 * the server identity the App was opened with.
 */
const appServerFields = {
  // Accepted for older renderers; the Session's own project is used.
  projectPath: Schema.optional(Schema.NullOr(Schema.String)),
  sessionId: Schema.optional(Schema.NullOr(Schema.String)),
  serverInstanceId: Schema.String,
  serverConfigHash: Schema.optional(Schema.String),
}

const catalogInputSchema = Schema.Struct(appServerFields)

const readResourceInputSchema = Schema.Struct({ ...appServerFields, uri: Schema.String })

const callToolInputSchema = Schema.Struct({
  ...appServerFields,
  toolName: Schema.String,
  arguments: Schema.Record({ key: Schema.String, value: mcpConfigValueSchema }),
})

function decode<A, I>(schema: Schema.Schema<A, I>, raw: unknown) {
  return Effect.try({
    try: () => decodeUnknownOrThrow(schema, raw),
    catch: () => new Error('Invalid MCP App request.'),
  })
}

/**
 * The App's server in its Session. The project and working path come from the Session, not the
 * request, so a cold connection starts where the Session's Runs do and matches their connection.
 */
function serverInput(input: {
  readonly sessionId?: string | null
  readonly serverInstanceId: string
  readonly serverConfigHash?: string
}) {
  return Effect.gen(function* () {
    const { sessionId, serverConfigHash } = input
    if (!sessionId) {
      return yield* Effect.fail(
        new Error('MCP Apps need the Session whose tool result opened them.'),
      )
    }
    if (!serverConfigHash) {
      return yield* Effect.fail(
        new Error('This MCP App was opened by an older OpenWaggle; run the tool again.'),
      )
    }
    const sessions = yield* SessionProjectionRepository
    const session = yield* sessions
      .getOptional(SessionId(sessionId))
      .pipe(Effect.mapError(() => new Error('The Session of this MCP App could not be read.')))
    if (!session) return yield* Effect.fail(new Error('The Session of this MCP App is gone.'))
    return {
      projectPath: session.projectPath,
      workingPath: resolveSessionWorkingDir(session, session.projectPath) ?? null,
      sessionId,
      serverName: input.serverInstanceId,
      serverIdentity: serverConfigHash,
    }
  })
}

function attribution(serverName: string) {
  return { serverInstanceId: serverName, serverLabel: serverName }
}

export function listMcpAppCatalogOperation(raw: unknown) {
  return Effect.gen(function* () {
    const server = yield* serverInput(yield* decode(catalogInputSchema, raw))
    const catalog = yield* (yield* McpAppRuntimeService).listCatalog(server)
    return { ...catalog, attribution: attribution(server.serverName) } satisfies McpAppCatalogResult
  })
}

export function readMcpResourceOperation(raw: unknown) {
  return Effect.gen(function* () {
    const input = yield* decode(readResourceInputSchema, raw)
    const server = yield* serverInput(input)
    const contents = yield* (yield* McpAppRuntimeService).readResource({
      ...server,
      uri: input.uri,
    })
    return { contents, attribution: attribution(server.serverName) } satisfies McpResourceResult
  })
}

export function callMcpAppToolOperation(raw: unknown) {
  return Effect.gen(function* () {
    const input = yield* decode(callToolInputSchema, raw)
    const server = yield* serverInput(input)
    const result = yield* (yield* McpAppRuntimeService).callTool({
      ...server,
      toolName: input.toolName,
      arguments: input.arguments,
    })
    return {
      ...result,
      attribution: {
        serverInstanceId: server.serverName,
        serverLabel: server.serverName,
        toolName: input.toolName,
      },
    } satisfies McpAppToolCallResult
  })
}
