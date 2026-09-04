import { SessionId } from '@shared/types/brand'
import type { GitRunStackedActionResult } from '@shared/types/git'
import type { SessionWorkspace } from '@shared/types/session'
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
          put: (output) =>
            Effect.sync(() => {
              pendingOutputs.push(output)
              return output
            }),
          list: () => Effect.succeed(pendingOutputs),
          remove: (output) =>
            Effect.sync(() => {
              const index = pendingOutputs.findIndex(({ id }) => id === output.id)
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
      recordStackedActionOutputs(result, sessionId, {
        nodeId: 'node-at-action',
        branchId: 'branch-at-action',
        createdAt: 1000,
      }).pipe(Effect.provide(layer)),
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

  it('uses the winning queued provenance when the same request is repeated on another branch', async () => {
    const upserts: Parameters<typeof sessionResourceTestLayer>[0] = []
    const removedIds: string[] = []
    const sessionId = SessionId('originating-session')
    const layer = Layer.mergeAll(
      sessionResourceTestLayer(upserts),
      Layer.succeed(
        SessionOutputRetryRepository,
        SessionOutputRetryRepository.of({
          put: (output) =>
            Effect.succeed({
              ...output,
              nodeId: 'original-node',
              branchId: 'original-branch',
              createdAt: 1000,
            }),
          list: () => Effect.succeed([]),
          remove: (output) =>
            Effect.sync(() => {
              removedIds.push(output.id)
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
      action: 'create_pr',
      branch: { status: 'unchanged', name: 'feature/later' },
      commit: null,
      changeRequest: {
        title: 'Complete session summary',
        url: 'https://github.com/openwaggle/openwaggle/pull/42',
        baseRef: 'main',
        headRef: 'feature/later',
        state: 'open',
      },
    }

    const recorded = await Effect.runPromise(
      recordStackedActionOutputs(result, sessionId, {
        nodeId: 'later-node',
        branchId: 'later-branch',
        createdAt: 2000,
      }).pipe(Effect.provide(layer)),
    )

    expect(recorded).toMatchObject({ changeRequestOutput: { ok: true } })
    expect(upserts).toHaveLength(1)
    expect(upserts[0]?.occurrence).toMatchObject({
      nodeId: 'original-node',
      branchId: 'original-branch',
      createdAt: 1000,
    })
    expect(removedIds).toHaveLength(1)
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
            put: (output) =>
              queueFails
                ? Effect.fail(
                    new SessionOutputRetryRepositoryError({ operation: 'put', cause: 'offline' }),
                  )
                : Effect.succeed(output),
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
        recordStackedActionOutputs(result, sessionId, {
          nodeId: 'node-at-action',
          branchId: 'branch-at-action',
          createdAt: 1000,
        }).pipe(Effect.provide(layer)),
      )

      expect(recorded.ok).toBe(true)
      if (!recorded.ok) throw new Error('Expected the change request to be created.')
      expect(recorded.changeRequestOutput).toMatchObject({ ok: false, retryPersisted })
    },
  )

  it('keeps the original Output provenance when retry cleanup fails', async () => {
    const upserts: Parameters<typeof sessionResourceTestLayer>[0] = []
    const pendingOutputs: PendingSessionOutput[] = []
    const sessionId = SessionId('originating-session')
    const layer = Layer.mergeAll(
      sessionResourceTestLayer(upserts),
      Layer.succeed(
        SessionOutputRetryRepository,
        SessionOutputRetryRepository.of({
          put: (output) =>
            Effect.sync(() => {
              pendingOutputs.push(output)
              return output
            }),
          list: () => Effect.succeed(pendingOutputs),
          remove: () =>
            Effect.fail(
              new SessionOutputRetryRepositoryError({
                operation: 'remove',
                cause: 'database busy',
              }),
            ),
        }),
      ),
      Layer.succeed(
        SessionRepository,
        SessionRepository.of(
          fromPartial<SessionRepositoryShape>({
            getWorkspace: () =>
              Effect.succeed(
                fromPartial<SessionWorkspace>({
                  activeNodeId: 'node-at-commit',
                  activeBranchId: 'branch-at-commit',
                }),
              ),
          }),
        ),
      ),
    )
    const result: GitRunStackedActionResult = {
      ok: true,
      action: 'commit',
      branch: { status: 'unchanged', name: 'feature/current' },
      commit: { commitHash: 'abc123', summary: 'Complete session summary' },
      changeRequest: null,
    }

    await Effect.runPromise(
      recordStackedActionOutputs(result, sessionId, {
        nodeId: 'node-at-commit',
        branchId: 'branch-at-commit',
        createdAt: 1000,
      }).pipe(Effect.provide(layer)),
    )

    expect(pendingOutputs).toHaveLength(1)
    expect(pendingOutputs[0]).toMatchObject({
      nodeId: 'node-at-commit',
      branchId: 'branch-at-commit',
    })
    expect(upserts[0]?.occurrence).toMatchObject({
      nodeId: pendingOutputs[0]?.nodeId,
      branchId: pendingOutputs[0]?.branchId,
      createdAt: pendingOutputs[0]?.createdAt,
    })
  })
})
