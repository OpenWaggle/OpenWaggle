import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { SessionQueryRepositoryShape } from '../../ports/session-query-repository'
import { dispatchNonHostUiLocalSessionCommand } from '../local-session-command-dispatcher'
import { dispatchSessionRepositoryQuery } from '../local-session-query-dispatcher'
import {
  caller,
  GUI_LOCAL_USER_CALLER,
  type LiveProfile,
  LOCAL_USER_CALLER,
  PROJECT_A,
  PROJECT_B,
  payload,
  searchResponse,
  testLayer,
} from './local-session-command-search-authorization.test-support'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('Local Session semantic search authorization', () => {
  it('executes a fresh semantic search once through the unrestricted GUI dispatcher', async () => {
    const liveProfile: LiveProfile = {
      capabilities: ['sessions:discover', 'sessions:read'],
      scope: { projectPaths: [PROJECT_A] },
      authorizationCeiling: 'yolo',
      revokedAt: null,
    }
    const execute = vi.fn<SessionQueryRepositoryShape['execute']>(() =>
      Effect.succeed(searchResponse(payload.request.requestId, 'project-a', PROJECT_A)),
    )

    await expect(
      Effect.runPromise(
        dispatchNonHostUiLocalSessionCommand({
          caller: GUI_LOCAL_USER_CALLER,
          payload,
        }).pipe(Effect.provide(testLayer(liveProfile, { execute }))),
      ),
    ).resolves.toMatchObject({
      response: { outcome: { sessions: [{ sessionId: 'project-a' }] } },
    })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('does not repeat a fresh search for an unrestricted local user', async () => {
    const liveProfile: LiveProfile = {
      capabilities: ['sessions:discover', 'sessions:read'],
      scope: { projectPaths: [PROJECT_A] },
      authorizationCeiling: 'yolo',
      revokedAt: null,
    }
    const execute = vi.fn<SessionQueryRepositoryShape['execute']>(() =>
      Effect.succeed(searchResponse(payload.request.requestId, 'project-a', PROJECT_A)),
    )

    await expect(
      Effect.runPromise(
        dispatchSessionRepositoryQuery(LOCAL_USER_CALLER, payload).pipe(
          Effect.provide(testLayer(liveProfile, { execute })),
        ),
      ),
    ).resolves.toMatchObject({
      response: { outcome: { sessions: [{ sessionId: 'project-a' }] } },
    })
    expect(execute).toHaveBeenCalledOnce()
  })

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
    const execute = vi.fn<SessionQueryRepositoryShape['execute']>(() =>
      Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => (searchInterrupted = true)))),
    )
    const running = Effect.runPromise(
      dispatchSessionRepositoryQuery(caller, payload, controller.signal).pipe(
        Effect.provide(testLayer(liveProfile, { execute })),
      ),
    )

    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
    controller.abort(new Error('connection closed'))

    await expect(running).rejects.toThrow('connection closed')
    expect(searchInterrupted).toBe(true)
  })
})
