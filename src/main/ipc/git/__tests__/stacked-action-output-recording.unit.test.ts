import { SessionId } from '@shared/types/brand'
import type { GitRunStackedActionResult } from '@shared/types/git'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { sessionResourceTestLayer } from '../../../application/__tests__/session-resource-capture.fixtures'
import { SessionOutputRetryRepositoryError } from '../../../errors'
import {
  type PendingSessionOutput,
  SessionOutputRetryRepository,
} from '../../../ports/session-output-retry-repository'
import { SessionRepository, type SessionRepositoryShape } from '../../../ports/session-repository'
import { recordStackedActionOutputs } from '../stacked-action-output-recording'

const broadcastToWindows = vi.hoisted(() => vi.fn())

vi.mock('../../../utils/broadcast', () => ({ broadcastToWindows }))

describe('stacked action Output recording', () => {
  it('records the commit and created request only in the originating session', async () => {
    const upserts: Parameters<typeof sessionResourceTestLayer>[0] = []
    const pendingOutputs: PendingSessionOutput[] = []
    const sessionId = SessionId('originating-session')
    const layer = Layer.mergeAll(
      sessionResourceTestLayer(upserts),
      Layer.succeed(
        SessionOutputRetryRepository,
        SessionOutputRetryRepository.of({
          put: (output) => Effect.sync(() => pendingOutputs.push(output)),
          list: () => Effect.succeed(pendingOutputs),
          remove: (_sessionId, outputId) =>
            Effect.sync(() => {
              const index = pendingOutputs.findIndex(({ id }) => id === outputId)
              if (index !== -1) pendingOutputs.splice(index, 1)
            }),
        }),
      ),
      Layer.succeed(
        SessionRepository,
        SessionRepository.of(
          fromPartial<SessionRepositoryShape>({
            getWorkspace: () => Effect.succeed(null),
          }),
        ),
      ),
    )
    const result: GitRunStackedActionResult = {
      ok: true,
      action: 'commit_push_pr',
      branch: { status: 'created', name: 'codex/session-summary' },
      commit: { commitHash: 'abc123', summary: 'Complete session summary' },
      changeRequest: {
        title: 'Complete session summary',
        url: 'https://github.com/openwaggle/openwaggle/pull/42',
        baseRef: 'main',
        headRef: 'codex/session-summary',
        state: 'open',
      },
    }

    const recorded = await Effect.runPromise(
      recordStackedActionOutputs(result, sessionId).pipe(Effect.provide(layer)),
    )

    expect(recorded).toMatchObject({
      commitOutput: { ok: true },
      changeRequestOutput: { ok: true },
    })
    expect(
      upserts.map(({ kind, sessionId: recordedSessionId }) => [kind, recordedSessionId]),
    ).toEqual([
      ['commit', sessionId],
      ['change-request', sessionId],
    ])
    expect(broadcastToWindows).toHaveBeenCalledTimes(2)
    expect(pendingOutputs).toEqual([])
  })

  it.each([
    ['persists', false, true],
    ['cannot persist', true, false],
  ] as const)(
    '%s retry authorization when Output recording fails',
    async (_label, queueFails, retryPersisted) => {
      const sessionId = SessionId('originating-session')
      const result: GitRunStackedActionResult = {
        ok: true,
        action: 'create_pr',
        branch: { status: 'unchanged', name: null },
        commit: null,
        changeRequest: {
          title: 'Complete session summary',
          url: 'https://github.com/openwaggle/openwaggle/pull/42',
          baseRef: 'main',
          headRef: 'codex/session-summary',
          state: 'open',
        },
      }
      const layer = Layer.mergeAll(
        sessionResourceTestLayer([], { upsertFails: true }),
        Layer.succeed(
          SessionOutputRetryRepository,
          SessionOutputRetryRepository.of({
            put: () =>
              queueFails
                ? Effect.fail(
                    new SessionOutputRetryRepositoryError({ operation: 'put', cause: 'offline' }),
                  )
                : Effect.void,
            list: () => Effect.succeed([]),
            remove: () => Effect.void,
          }),
        ),
        Layer.succeed(
          SessionRepository,
          SessionRepository.of(
            fromPartial<SessionRepositoryShape>({
              getWorkspace: () => Effect.succeed(null),
            }),
          ),
        ),
      )

      const recorded = await Effect.runPromise(
        recordStackedActionOutputs(result, sessionId).pipe(Effect.provide(layer)),
      )

      expect(recorded.ok).toBe(true)
      if (!recorded.ok) throw new Error('Expected the change request to be created.')
      expect(recorded.changeRequestOutput).toMatchObject({ ok: false, retryPersisted })
    },
  )
})
