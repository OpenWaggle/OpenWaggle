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
  const outcome = Reflect.get(
    Object(Reflect.get(Object(result.structuredContent), 'response')),
    'outcome',
  )
  const listed: unknown = Reflect.get(Object(outcome), 'sessions')
  return Array.isArray(listed)
    ? listed.map((session) => Reflect.get(Object(session), 'sessionId'))
    : []
}

export function advertisedOperations(tool: { readonly inputSchema: unknown }) {
  const text = JSON.stringify(tool.inputSchema)
  return [...text.matchAll(/"operation":\{"type":"string","const":"([^"]+)"\}/g)]
    .map((match) => match[1])
    .sort()
}
