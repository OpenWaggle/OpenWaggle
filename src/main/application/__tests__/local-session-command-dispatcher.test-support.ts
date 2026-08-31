import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import { SettingsService } from '../../services/settings-service'

const targetLayer = Layer.succeed(SessionAuthorizationTargetRepository, {
  resolve: (sessionId) =>
    Effect.succeed({
      sessionId,
      projectPath: '/allowed-project',
      hiveRootSessionId: 'session-queen',
      authorizationCeiling: 'yolo',
    }),
  resolveDelegation: (delegationId) =>
    Effect.succeed({
      sessionId: `worker-for-${delegationId}`,
      projectPath: '/allowed-project',
      hiveRootSessionId: 'session-queen',
      authorizationCeiling: 'yolo',
    }),
  listLiveDerivedAuthorities: () => Effect.succeed([]),
})

export const settingsLayer = Layer.succeed(SettingsService, {
  get: () => Effect.succeed(DEFAULT_SETTINGS),
  update: () => Effect.void,
  initialize: () => Effect.void,
  flushForTests: () => Effect.void,
})

export const authorizationLayer = Layer.mergeAll(targetLayer, settingsLayer)
export const localUser: LocalSessionCallerIdentity = { callerId: 'local-user:machine' }

export function restrictedCaller(
  overrides: Partial<NonNullable<LocalSessionCallerIdentity['profileAuthority']>> = {},
): LocalSessionCallerIdentity {
  return {
    callerId: 'profile:worker-client',
    profileAuthority: {
      profileId: 'worker-client',
      profileName: 'worker-client',
      capabilities: ['sessions:start'],
      scope: { projectPaths: ['/allowed-project'] },
      authorizationCeiling: 'ask-for-approval',
      ...overrides,
    },
  }
}

export function startPayload(runAuthorizationOverride: 'yolo' | 'ask-for-approval') {
  return {
    contract: 'session-control-v2',
    request: {
      contractVersion: 2,
      requestId: 'request-start',
      idempotencyKey: 'idempotency-start',
      command: {
        operation: 'start',
        sessionId: 'session-worker',
        runAuthorizationOverride,
        input: { text: 'Continue.', attachmentIds: [] },
      },
    },
  } satisfies LocalSessionCommandPayload
}

export function controlPayload(
  command: Extract<
    LocalSessionCommandPayload,
    { readonly contract: 'session-control-v2' }
  >['request']['command'],
): LocalSessionCommandPayload {
  return {
    contract: 'session-control-v2',
    request: {
      contractVersion: 2,
      requestId: `request-${command.operation}`,
      idempotencyKey: `idempotency-${command.operation}`,
      command,
    },
  }
}

export function queryPayload(
  query:
    | { readonly operation: 'list'; readonly limit: number; readonly projectPath?: string }
    | {
        readonly operation: 'search'
        readonly query: string
        readonly limit: number
        readonly searchScope?: 'discovery' | 'full-transcript'
      }
    | { readonly operation: 'read'; readonly sessionId: string },
): LocalSessionCommandPayload {
  return {
    contract: 'session-query-v2',
    request: { contractVersion: 2, requestId: 'request-query', query },
  }
}
