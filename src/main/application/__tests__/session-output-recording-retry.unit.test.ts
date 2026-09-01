import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import {
  type PendingSessionOutput,
  SessionOutputRetryRepository,
} from '../../ports/session-output-retry-repository'
import {
  listPendingSessionOutputs,
  pendingCommitOutput,
  putPendingSessionOutput,
  removePendingSessionOutput,
} from '../session-change-request-output-retry'

describe('pending session output recording', () => {
  it('keeps durable commit retries isolated to their originating session', async () => {
    const first = SessionId('first-session')
    const second = SessionId('second-session')
    const commit = { commitHash: 'abc123', summary: 'Complete resource hub' }
    const rows: PendingSessionOutput[] = []
    const layer = Layer.succeed(
      SessionOutputRetryRepository,
      SessionOutputRetryRepository.of({
        put: (output) => Effect.sync(() => rows.push(output)),
        list: (sessionId) =>
          Effect.succeed(rows.filter((output) => output.sessionId === sessionId)),
        remove: (sessionId, outputId) =>
          Effect.sync(() => {
            const index = rows.findIndex(
              (output) => output.sessionId === sessionId && output.id === outputId,
            )
            if (index !== -1) rows.splice(index, 1)
          }),
      }),
    )
    const pending = pendingCommitOutput(first, commit)

    await Effect.runPromise(putPendingSessionOutput(pending).pipe(Effect.provide(layer)))

    expect(
      await Effect.runPromise(listPendingSessionOutputs(first).pipe(Effect.provide(layer))),
    ).toEqual([pending])
    expect(
      await Effect.runPromise(listPendingSessionOutputs(second).pipe(Effect.provide(layer))),
    ).toEqual([])
    await Effect.runPromise(removePendingSessionOutput(pending).pipe(Effect.provide(layer)))
    expect(
      await Effect.runPromise(listPendingSessionOutputs(first).pipe(Effect.provide(layer))),
    ).toEqual([])
  })
})
