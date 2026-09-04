import { SessionId } from '@shared/types/brand'
import type { GitRunStackedActionResult } from '@shared/types/git'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import { SessionOutputRetryRepository } from '../../../ports/session-output-retry-repository'
import { SessionRepository, type SessionRepositoryShape } from '../../../ports/session-repository'
import {
  SessionResourceRepository,
  type SessionResourceRepositoryShape,
  type UpsertSessionResourceInput,
} from '../../../ports/session-resource-repository'
import { recordStackedActionOutputs } from '../stacked-action-output-recording'

function deferred() {
  let resolve: (() => void) | undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve: () => resolve?.() }
}

describe('stacked action Output recording concurrency', () => {
  it('serializes queue, resource recording, and cleanup for one session', async () => {
    const firstEntered = deferred()
    const releaseFirst = deferred()
    let upsertCount = 0
    const layer = Layer.mergeAll(
      Layer.succeed(
        SessionOutputRetryRepository,
        SessionOutputRetryRepository.of({
          put: (output) => Effect.succeed(output),
          list: () => Effect.succeed([]),
          remove: () => Effect.void,
        }),
      ),
      Layer.succeed(
        SessionResourceRepository,
        SessionResourceRepository.of(
          fromPartial<SessionResourceRepositoryShape>({
            upsert: (input: UpsertSessionResourceInput) =>
              Effect.promise(async () => {
                upsertCount += 1
                if (upsertCount === 1) {
                  firstEntered.resolve()
                  await releaseFirst.promise
                }
                return {
                  ...input,
                  occurrences: [input.occurrence],
                  isSource: false,
                  isOutput: true,
                }
              }),
          }),
        ),
      ),
      Layer.succeed(
        SessionRepository,
        SessionRepository.of(
          fromPartial<SessionRepositoryShape>({ getWorkspace: () => Effect.succeed(null) }),
        ),
      ),
    )
    const sessionId = SessionId('originating-session')
    const result: GitRunStackedActionResult = {
      ok: true,
      action: 'create_pr',
      branch: { status: 'unchanged', name: 'feature/session-summary' },
      commit: null,
      changeRequest: {
        title: 'Complete session summary',
        url: 'https://github.com/openwaggle/openwaggle/pull/42',
        baseRef: 'main',
        headRef: 'feature/session-summary',
        state: 'open',
      },
    }
    const record = (createdAt: number) =>
      Effect.runPromise(
        recordStackedActionOutputs(result, sessionId, {
          nodeId: `node-${createdAt}`,
          branchId: `branch-${createdAt}`,
          createdAt,
        }).pipe(Effect.provide(layer)),
      )

    const first = record(1000)
    await firstEntered.promise
    const second = record(2000)
    await Promise.resolve()

    expect(upsertCount).toBe(1)
    releaseFirst.resolve()
    await Promise.all([first, second])
    expect(upsertCount).toBe(2)
  })
})
