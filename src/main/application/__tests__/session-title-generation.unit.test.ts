import { SessionId, SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import { Deferred, Effect, Fiber, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { SessionTitleGenerator } from '../../ports/session-title-generator'
import type { SessionTitleState } from '../../ports/session-title-repository'
import { SettingsService } from '../../services/settings-service'
import { generateTitle } from '../session-title-generation'

const STATE: SessionTitleState = {
  sessionId: SessionId('s'),
  title: 'title',
  source: 'provisional',
  needsRefinement: false,
  projectPath: null,
  executionModel: SupportedModelId('anthropic/claude-sonnet'),
  archived: false,
  isWorker: false,
  updatedAt: 0,
}

describe('generateTitle', () => {
  it('runs at most two background requests at a time, and never holds up a user request', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const release = yield* Deferred.make<void>()
        let running = 0
        let peak = 0
        const generator = SessionTitleGenerator.of({
          generate: () =>
            Effect.gen(function* () {
              running += 1
              peak = Math.max(peak, running)
              yield* Deferred.await(release)
              running -= 1
              return { text: '{"title":"Done"}', modelRef: SupportedModelId('a/b') }
            }),
        })
        const layer = Layer.mergeAll(
          Layer.succeed(SessionTitleGenerator, generator),
          Layer.succeed(
            SettingsService,
            fromPartial({ get: () => Effect.succeed(DEFAULT_SETTINGS) }),
          ),
        )
        const request = (priority: 'background' | 'user') =>
          generateTitle({
            state: STATE,
            sessionModel: null,
            message: 'Hello',
            priority,
          }).pipe(Effect.provide(layer))
        const background = yield* Effect.forkAll(
          ['background', 'background', 'background', 'background'].map(() => request('background')),
        )
        const user = yield* Effect.fork(request('user'))
        yield* Effect.yieldNow()
        yield* Effect.sleep('10 millis')
        const runningBeforeRelease = running
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(background)
        yield* Fiber.join(user)
        return { peak, runningBeforeRelease }
      }),
    )

    // Two background permits plus the user request that skipped the queue.
    expect(result.runningBeforeRelease).toBe(3)
    expect(result.peak).toBe(3)
  })

  it('sends no queued request once the Title model is turned Off', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const release = yield* Deferred.make<void>()
        let sent = 0
        let settings = DEFAULT_SETTINGS
        const generator = SessionTitleGenerator.of({
          generate: () =>
            Effect.gen(function* () {
              sent += 1
              yield* Deferred.await(release)
              return { text: '{"title":"Done"}', modelRef: SupportedModelId('a/b') }
            }),
        })
        const layer = Layer.mergeAll(
          Layer.succeed(SessionTitleGenerator, generator),
          Layer.succeed(SettingsService, fromPartial({ get: () => Effect.sync(() => settings) })),
        )
        const request = generateTitle({
          state: STATE,
          sessionModel: null,
          message: 'Hello',
        }).pipe(Effect.either, Effect.provide(layer))
        const fibers = yield* Effect.forkAll([request, request, request, request])
        yield* Effect.sleep('10 millis')
        settings = { ...DEFAULT_SETTINGS, sessionTitleModel: 'off' }
        yield* Deferred.succeed(release, undefined)
        const outcomes = yield* Fiber.join(fibers)
        return { sent, outcomes: outcomes.map((outcome) => outcome._tag) }
      }),
    )

    // The two holding a permit were already sent; the two still queued never were.
    expect(result.sent).toBe(2)
    expect(result.outcomes).toEqual(['Right', 'Right', 'Left', 'Left'])
  })
})
