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
import { describe, expect, it, vi } from 'vitest'
import { LocalSessionProfileRepository } from '../../ports/local-session-profile-repository'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import {
  SessionQueryRepository,
  type SessionQueryRepositoryShape,
} from '../../ports/session-query-repository'
import { SessionWaitService } from '../../ports/session-wait-service'
import { SettingsService } from '../../services/settings-service'
import { dispatchSessionRepositoryQuery } from '../local-session-query-dispatcher'

const PROJECT_A = fs.realpathSync(os.tmpdir())
const PROJECT_B = '/'

type LiveProfile = {
  capabilities: LocalSessionProfileAuthority['capabilities']
  scope: LocalSessionProfileAuthority['scope']
  authorizationCeiling: LocalSessionProfileAuthority['authorizationCeiling']
  revokedAt: number | null
}

const caller: LocalSessionCallerIdentity = {
  callerId: 'profile:semantic-reader',
  profileAuthority: {
    profileId: 'semantic-reader',
    profileName: 'semantic-reader',
    capabilities: ['sessions:discover', 'sessions:read'],
    scope: { projectPaths: [PROJECT_A] },
    authorizationCeiling: 'yolo',
  },
}

const payload = {
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

function searchResponse(
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

function testLayer(liveProfile: LiveProfile, repository: SessionQueryRepositoryShape) {
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

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('Local Session semantic search authorization', () => {
  it('revalidates a named profile after waiting for fresh transcript embeddings', async () => {
    const gate = deferred()
    const liveProfile: LiveProfile = {
      capabilities: ['sessions:discover', 'sessions:read'],
      scope: { projectPaths: [PROJECT_A] },
      authorizationCeiling: 'yolo',
      revokedAt: null,
    }
    const execute = vi.fn<SessionQueryRepositoryShape['execute']>(() =>
      Effect.promise(async () => {
        await gate.promise
        return searchResponse('stale', 'project-a', PROJECT_A)
      }),
    )
    const running = Effect.runPromise(
      dispatchSessionRepositoryQuery(caller, payload).pipe(
        Effect.provide(testLayer(liveProfile, { execute })),
        Effect.flip,
      ),
    )

    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    liveProfile.capabilities = ['sessions:discover']
    gate.resolve()

    await expect(running).resolves.toMatchObject({ code: 'capability_denied' })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('reruns under the named profile current scope before returning results', async () => {
    const gate = deferred()
    const liveProfile: LiveProfile = {
      capabilities: ['sessions:discover', 'sessions:read'],
      scope: { projectPaths: [PROJECT_A] },
      authorizationCeiling: 'yolo',
      revokedAt: null,
    }
    const seen: Array<{
      readonly authority?: LocalSessionProfileAuthority
      readonly requireFresh?: boolean
      readonly waitTimeoutMs?: number
    }> = []
    const execute: SessionQueryRepositoryShape['execute'] = (input) => {
      const query = input.request.query
      if (query.operation !== 'search') return Effect.die('Expected search query.')
      seen.push({
        ...(input.authority ? { authority: input.authority } : {}),
        ...(query.requireFresh === undefined ? {} : { requireFresh: query.requireFresh }),
        ...(query.waitTimeoutMs === undefined ? {} : { waitTimeoutMs: query.waitTimeoutMs }),
      })
      return seen.length === 1
        ? Effect.promise(async () => {
            await gate.promise
            return searchResponse(input.request.requestId, 'project-a', PROJECT_A)
          })
        : Effect.succeed(searchResponse(input.request.requestId, 'project-b', PROJECT_B))
    }
    const running = Effect.runPromise(
      dispatchSessionRepositoryQuery(caller, payload).pipe(
        Effect.provide(testLayer(liveProfile, { execute })),
      ),
    )

    await vi.waitFor(() => expect(seen).toHaveLength(1))
    liveProfile.scope = { projectPaths: [PROJECT_B] }
    gate.resolve()

    await expect(running).resolves.toMatchObject({
      response: { outcome: { sessions: [{ sessionId: 'project-b' }] } },
    })
    expect(seen).toMatchObject([
      { authority: { scope: { projectPaths: [PROJECT_A] } }, requireFresh: true },
      {
        authority: { scope: { projectPaths: [PROJECT_B] } },
        requireFresh: false,
        waitTimeoutMs: 0,
      },
    ])
  })

  it('interrupts freshness waiting when the client connection closes', async () => {
    const controller = new AbortController()
    const liveProfile: LiveProfile = {
      capabilities: ['sessions:discover', 'sessions:read'],
      scope: { projectPaths: [PROJECT_A] },
      authorizationCeiling: 'yolo',
      revokedAt: null,
    }
    let searchInterrupted = false
    const execute: SessionQueryRepositoryShape['execute'] = () =>
      Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => (searchInterrupted = true))))
    const running = Effect.runPromise(
      dispatchSessionRepositoryQuery(caller, payload, controller.signal).pipe(
        Effect.provide(testLayer(liveProfile, { execute })),
      ),
    )

    controller.abort(new Error('connection closed'))

    await expect(running).rejects.toThrow('connection closed')
    expect(searchInterrupted).toBe(true)
  })
})
