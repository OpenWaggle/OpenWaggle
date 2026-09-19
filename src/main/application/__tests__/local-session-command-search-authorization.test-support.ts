import fs from 'node:fs'
import os from 'node:os'
import type {
  LocalSessionCallerIdentity,
  LocalSessionProfileAuthority,
} from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import type { SessionQueryResponse } from '@shared/types/session-query'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { LocalSessionProfileRepository } from '../../ports/local-session-profile-repository'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import {
  SessionQueryRepository,
  type SessionQueryRepositoryShape,
} from '../../ports/session-query-repository'
import { SessionWaitService } from '../../ports/session-wait-service'
import { SettingsService } from '../../services/settings-service'

export const PROJECT_A = fs.realpathSync(os.tmpdir())
export const PROJECT_B = '/'

export type LiveProfile = {
  capabilities: LocalSessionProfileAuthority['capabilities']
  scope: LocalSessionProfileAuthority['scope']
  authorizationCeiling: LocalSessionProfileAuthority['authorizationCeiling']
  revokedAt: number | null
}

export const caller: LocalSessionCallerIdentity = {
  callerId: 'profile:semantic-reader',
  profileAuthority: {
    profileId: 'semantic-reader',
    profileName: 'semantic-reader',
    capabilities: ['sessions:discover', 'sessions:read'],
    scope: { projectPaths: [PROJECT_A] },
    authorizationCeiling: 'yolo',
  },
}

export const LOCAL_USER_CALLER: LocalSessionCallerIdentity = { callerId: 'local-user:machine' }
export const GUI_LOCAL_USER_CALLER: LocalSessionCallerIdentity = { callerId: 'gui:local-user' }

export const payload = {
  contract: 'session-query-v2',
  request: {
    contractVersion: 2,
    requestId: 'semantic-search',
    query: {
      operation: 'search',
      query: 'durable session protocol',
      searchScope: 'full-transcript',
      mode: 'semantic',
      requireFresh: true,
      waitTimeoutMs: 1_000,
      limit: 10,
    },
  },
} as const satisfies LocalSessionCommandPayload

export function searchResponse(
  requestId: string,
  sessionId: string,
  projectPath: string,
): SessionQueryResponse {
  return {
    contractVersion: 2,
    requestId,
    outcome: {
      operation: 'search',
      sessions: [
        {
          sessionId,
          title: sessionId,
          projectPath,
          archived: false,
          createdAt: 1,
          updatedAt: 1,
          lineageRole: 'independent',
          directWorkerCount: 0,
        },
      ],
      requestedSearchMode: 'semantic',
      searchBackend: 'semantic',
    },
  }
}

export function testLayer(liveProfile: LiveProfile, repository: SessionQueryRepositoryShape) {
  const profileRepository = Layer.succeed(LocalSessionProfileRepository, {
    list: () => Effect.succeed([]),
    findForAuthentication: () => Effect.succeed(null),
    findById: () =>
      Effect.succeed({
        id: 'semantic-reader',
        name: 'semantic-reader',
        credentialVerifier: 'unused',
        capabilities: liveProfile.capabilities,
        scope: liveProfile.scope,
        authorizationCeiling: liveProfile.authorizationCeiling,
        revokedAt: liveProfile.revokedAt,
      }),
    recordAuthentication: () => Effect.void,
    executeManagement: () => Effect.die('Profile management is not used in this test.'),
  })
  const targets = Layer.succeed(SessionAuthorizationTargetRepository, {
    resolve: (sessionId) =>
      Effect.succeed({
        sessionId,
        projectPath: PROJECT_A,
        hiveRootSessionId: sessionId,
        authorizationCeiling: 'yolo' as const,
      }),
    resolveDelegation: (delegationId) =>
      Effect.succeed({
        sessionId: delegationId,
        projectPath: PROJECT_A,
        hiveRootSessionId: delegationId,
        authorizationCeiling: 'yolo' as const,
      }),
    listLiveDerivedAuthorities: () => Effect.succeed([]),
  })
  const settings = Layer.succeed(SettingsService, {
    get: () => Effect.succeed(DEFAULT_SETTINGS),
    update: () => Effect.void,
    initialize: () => Effect.void,
    flushForTests: () => Effect.void,
  })
  return Layer.mergeAll(
    profileRepository,
    targets,
    settings,
    Layer.succeed(SessionQueryRepository, repository),
    Layer.succeed(SessionWaitService, {
      wait: () => Effect.die('Session waiting is not used in this test.'),
      waitForExport: () => Effect.die('Export waiting is not used in this test.'),
    }),
  )
}
