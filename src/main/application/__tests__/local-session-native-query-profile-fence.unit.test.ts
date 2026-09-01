import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import { LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION } from '@shared/types/local-session-profile-management'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import { SessionQueryRepository } from '../../ports/session-query-repository'
import { SessionWaitService } from '../../ports/session-wait-service'
import { SettingsService } from '../../services/settings-service'
import { dispatchObservedLocalSessionQuery } from '../local-session-observed-query'
import { acquireLocalSessionProfileBackgroundWork } from '../local-session-profile-background-work'
import { manageLocalSessionProfiles } from '../local-session-profile-management'
import {
  localSessionProfileManagementTestLayer,
  PROJECT_PATH,
  profileManagementRequest,
} from './local-session-profile-management.test-support'

const PROFILE = {
  id: 'origin-profile',
  name: 'origin-profile',
  credentialVerifier: 'unused',
  capabilities: ['sessions:read'] as const,
  scope: { projectPaths: [PROJECT_PATH] },
  authorizationCeiling: 'ask-for-approval' as const,
  revokedAt: null,
}

const SESSION_AGENT: LocalSessionCallerIdentity = {
  callerId: 'session-agent:queen:run-1',
  workingDirectory: PROJECT_PATH,
  profileAuthority: {
    profileId: 'session-agent:queen',
    profileName: 'session-agent:queen',
    capabilities: ['sessions:discover', 'sessions:read', 'sessions:respond'],
    scope: { projectPaths: [PROJECT_PATH] },
    authorizationCeiling: 'ask-for-approval',
  },
}

type SessionQueryPayload = Extract<
  LocalSessionCommandPayload,
  { readonly contract: 'session-query-v2' }
>

const PAYLOADS = {
  read: {
    contract: 'session-query-v2',
    request: {
      contractVersion: 2,
      requestId: 'read',
      query: { operation: 'read', sessionId: 'worker' },
    },
  },
  search: {
    contract: 'session-query-v2',
    request: {
      contractVersion: 2,
      requestId: 'search',
      query: {
        operation: 'search',
        query: 'blocked search',
        projectPath: PROJECT_PATH,
        searchScope: 'full-transcript',
        mode: 'semantic',
        limit: 10,
        requireFresh: true,
        waitTimeoutMs: 1_000,
      },
    },
  },
  'requests-list': {
    contract: 'session-query-v2',
    request: {
      contractVersion: 2,
      requestId: 'requests-list',
      query: { operation: 'requests-list', sessionId: 'worker' },
    },
  },
} as const satisfies Record<string, SessionQueryPayload>

function managementResponse(
  operation: 'update' | 'revoke',
  input: { readonly request: { readonly requestId: string; readonly idempotencyKey: string } },
) {
  return {
    contractVersion: LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION,
    requestId: input.request.requestId,
    idempotencyKey: input.request.idempotencyKey,
    replayed: false,
    outcome:
      operation === 'update'
        ? {
            operation,
            effect: 'profile-updated' as const,
            profile: { ...PROFILE, lastAuthenticatedAt: null, createdAt: 1, updatedAt: 2 },
          }
        : {
            operation,
            effect: 'profile-revoked' as const,
            profile: {
              ...PROFILE,
              revokedAt: 2,
              lastAuthenticatedAt: null,
              createdAt: 1,
              updatedAt: 2,
            },
            interruptedRuns: [],
          },
  }
}

function queryLayer(input: {
  readonly admitted: () => boolean
  readonly blockTarget: boolean
  readonly blocked: () => void
}) {
  const block = () => Effect.sync(input.blocked).pipe(Effect.zipRight(Effect.never))
  return Layer.mergeAll(
    Layer.succeed(SessionAuthorizationTargetRepository, {
      resolve: (sessionId) =>
        input.blockTarget && input.admitted()
          ? block()
          : Effect.succeed({
              sessionId,
              projectPath: PROJECT_PATH,
              hiveRootSessionId: 'queen',
              authorizationCeiling: 'ask-for-approval' as const,
            }),
      resolveDelegation: () => Effect.die('Delegations are not used in this test.'),
      listLiveDerivedAuthorities: () => Effect.succeed([]),
    }),
    Layer.succeed(SessionQueryRepository, { execute: block }),
    Layer.succeed(SessionWaitService, {
      wait: () => Effect.die('Waiting is not used in this test.'),
      waitForExport: () => Effect.die('Waiting is not used in this test.'),
    }),
    Layer.succeed(SessionControlAttachmentService, {
      prepare: () => Effect.die('Attachments are not used in this test.'),
      bind: () => Effect.die('Attachments are not used in this test.'),
      resolve: () => Effect.die('Attachments are not used in this test.'),
      release: () => Effect.die('Attachments are not used in this test.'),
      cleanupUnreferenced: () => Effect.void,
    }),
    Layer.succeed(SettingsService, {
      get: () => Effect.succeed(DEFAULT_SETTINGS),
      update: () => Effect.void,
      initialize: () => Effect.void,
      flushForTests: () => Effect.void,
    }),
  )
}

function updateRequest(operation: 'update' | 'revoke') {
  return operation === 'update'
    ? profileManagementRequest({
        operation,
        profileName: PROFILE.name,
        capabilities: ['sessions:read'],
        scope: { projectPaths: [PROJECT_PATH] },
        authorizationCeiling: 'ask-for-approval',
      })
    : profileManagementRequest({ operation, profileName: PROFILE.name })
}

async function runRace(input: {
  readonly payload: SessionQueryPayload
  readonly operation: 'update' | 'revoke'
  readonly blockTarget: boolean
}) {
  let admitted = false
  let markBlocked!: () => void
  const blocked = new Promise<void>((resolve) => {
    markBlocked = resolve
  })
  const persist = vi.fn(async (request) => managementResponse(input.operation, request))
  const layer = Layer.mergeAll(
    localSessionProfileManagementTestLayer(persist, undefined, PROFILE),
    queryLayer({ admitted: () => admitted, blockTarget: input.blockTarget, blocked: markBlocked }),
  )
  const running = Effect.runPromise(
    dispatchObservedLocalSessionQuery({
      caller: SESSION_AGENT,
      payload: input.payload,
      observationAdmission: async () => {
        const lease = acquireLocalSessionProfileBackgroundWork(PROFILE.id, {
          cancelOnFence: true,
        })
        if (!lease) throw new Error('Profile authority is changing.')
        admitted = true
        return {
          caller: SESSION_AGENT,
          refreshCaller: () => Promise.resolve(SESSION_AGENT),
          ...(lease.signal ? { signal: lease.signal } : {}),
          release: lease.release,
        }
      },
    }).pipe(Effect.provide(layer)),
  )
  await blocked
  const management = Effect.runPromise(
    manageLocalSessionProfiles({
      caller: { callerId: 'gui:local-user' },
      request: updateRequest(input.operation),
      now: 2,
    }).pipe(Effect.provide(layer)),
  )
  await expect(running).rejects.toThrow('Profile authority changed')
  await management
  expect(persist).toHaveBeenCalledOnce()
}

describe('Pi-native Session query profile fencing', () => {
  it.each(['read', 'search', 'requests-list'] as const)(
    'aborts and drains a blocked %s observation before profile reduction persists',
    async (operation) => {
      await runRace({
        payload: PAYLOADS[operation],
        operation: 'update',
        blockTarget: operation !== 'search',
      })
    },
  )

  it.each(['update', 'revoke'] as const)(
    'cancels a long freshness-blocking search before profile %s persists',
    async (operation) => {
      await runRace({ payload: PAYLOADS.search, operation, blockTarget: false })
    },
  )
})
