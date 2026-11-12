import { decodeUnknownOrThrow, safeDecodeUnknown, Schema } from '@shared/schema'
import type { Client } from '@modelcontextprotocol/client'
import type {
  LocalSessionCallerIdentity,
  LocalSessionProfileScope,
} from '@shared/types/local-session-profile'
import type { SessionCapability } from '@shared/types/session-capability'
import * as Effect from 'effect/Effect'
import {
  authorizeSessionCapabilities,
  authorizeSessionTargetForCaller,
} from '../domain/session-control/session-capability-authorization'
import { LocalSessionCommandAuthorizationError } from '../errors'

/** The `list` answer's Session IDs, as the MCP tool's structured content carries them. */
const listedSessionsContentSchema = Schema.Struct({
  response: Schema.Struct({
    outcome: Schema.Struct({
      sessions: Schema.Array(Schema.Struct({ sessionId: Schema.Unknown })),
    }),
  }),
})

/** The query command the MCP server sends the fake Host. */
const queryPayloadSchema = Schema.Struct({
  request: Schema.Struct({
    requestId: Schema.Unknown,
    query: Schema.Struct({
      operation: Schema.Unknown,
      sessionId: Schema.optionalWith(Schema.Unknown, { exact: true }),
    }),
  }),
})

export interface StoredSession {
  readonly id: string
  readonly projectPath: string
}

export function sessionMatches(scope: LocalSessionProfileScope, session: StoredSession) {
  return (
    scope.all === true ||
    (scope.projectPaths ?? []).includes(session.projectPath) ||
    (scope.sessionIds ?? []).includes(session.id)
  )
}

export function listResult(
  sessions: readonly StoredSession[],
  requestId: string,
  caller: LocalSessionCallerIdentity,
) {
  const required: readonly SessionCapability[] = ['sessions:discover']
  const capabilities = authorizeSessionCapabilities(caller.profileAuthority, required)
  if (!capabilities.authorized) {
    return Effect.runPromise(
      Effect.fail(
        new LocalSessionCommandAuthorizationError({
          code: 'capability_denied',
          missing: capabilities.missing,
        }),
      ),
    )
  }
  return Promise.resolve({
    contract: 'session-query-v2',
    response: {
      contractVersion: 2,
      requestId,
      outcome: {
        operation: 'list',
        sessions: sessions
          .filter(
            (session) =>
              authorizeSessionTargetForCaller(
                caller,
                {
                  projectPath: session.projectPath,
                  sessionId: session.id,
                  hiveRootSessionId: session.id,
                },
                required,
              ).authorized,
          )
          .map((session) => ({
            sessionId: session.id,
            title: session.id,
            projectPath: session.projectPath,
            archived: false,
            createdAt: 1,
            updatedAt: 1,
            lineageRole: 'independent',
            directWorkerCount: 0,
          })),
      },
    },
  })
}

export async function listedSessionIds(client: Client) {
  const result = await client.callTool({
    name: 'openwaggle_hive',
    arguments: { operation: 'list' },
  })
  if (result.isError) throw new Error(JSON.stringify(result.content))
  const listed = safeDecodeUnknown(listedSessionsContentSchema, result.structuredContent)
  return listed.success
    ? listed.data.response.outcome.sessions.map((session) => session.sessionId)
    : []
}

export function advertisedOperations(tool: { readonly inputSchema: unknown }) {
  const text = JSON.stringify(tool.inputSchema)
  return [...text.matchAll(/"operation":\{"type":"string","const":"([^"]+)"\}/g)]
    .flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
    .sort()
}

function deny(code: 'capability_denied' | 'target_scope_denied', missing?: readonly string[]) {
  return Effect.runPromise(
    Effect.fail(
      new LocalSessionCommandAuthorizationError({ code, ...(missing ? { missing } : {}) }),
    ),
  )
}

/** `read` as the Host answers it: refused outside the caller's scope, unknown IDs not found. */
function readResult(
  sessions: readonly StoredSession[],
  requestId: string,
  sessionId: string,
  caller: LocalSessionCallerIdentity,
) {
  const required: readonly SessionCapability[] = ['sessions:read']
  const capabilities = authorizeSessionCapabilities(caller.profileAuthority, required)
  if (!capabilities.authorized) return deny('capability_denied', capabilities.missing)
  const session = sessions.find((candidate) => candidate.id === sessionId)
  const response = (outcome: object) =>
    Promise.resolve({
      contract: 'session-query-v2',
      response: { contractVersion: 2, requestId, outcome },
    })
  if (!session) {
    return response({
      operation: 'read',
      error: {
        code: 'session_not_found',
        kind: 'not_found',
        message: 'The Session was not found.',
      },
    })
  }
  const target = { projectPath: session.projectPath, sessionId, hiveRootSessionId: sessionId }
  if (!authorizeSessionTargetForCaller(caller, target, required).authorized) {
    return deny('target_scope_denied')
  }
  return response({
    operation: 'read',
    session: { sessionId, title: sessionId, projectPath: session.projectPath },
  })
}

/** The fake Host's query dispatcher: `read` and `list`. */
export function queryResult(
  sessions: readonly StoredSession[],
  payload: unknown,
  caller: LocalSessionCallerIdentity,
) {
  const { request } = decodeUnknownOrThrow(queryPayloadSchema, payload)
  const requestId = String(request.requestId)
  return request.query.operation === 'read'
    ? readResult(sessions, requestId, String(request.query.sessionId), caller)
    : listResult(sessions, requestId, caller)
}
