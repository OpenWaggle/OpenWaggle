import { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionWorkspace } from '@shared/types/session'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { SessionRepository } from '../../ports/session-repository'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { SessionResourceRepository } from '../../ports/session-resource-repository'
import { subscribeToSessionResourceInvalidations } from '../session-resource-invalidation'
import { recordSessionChangeRequest, recordSessionCommit } from '../session-resource-recording'

function recordingLayer(
  recorded: UpsertSessionResourceInput[],
  workspaceFor: (sessionId: SessionId) => Pick<SessionWorkspace, 'activeBranchId' | 'activeNodeId'>,
) {
  return Layer.merge(
    Layer.succeed(
      SessionResourceRepository,
      SessionResourceRepository.of({
        upsert: (input) => {
          recorded.push(input)
          return Effect.succeed({
            ...input,
            managed: input.managedPath !== null,
            occurrences: [input.occurrence],
            isSource: false,
            isOutput: true,
          })
        },
        list: () => Effect.succeed([]),
        listPage: () =>
          Effect.succeed({ resources: [], total: 0, nextCursor: null, orderRevision: 'none' }),
        findById: () => Effect.succeed(null),
        findByOccurrence: () => Effect.succeed(null),
        findByLocator: () => Effect.succeed(null),
        locateImage: () => Effect.succeed(null),
        findByCanonicalKey: () => Effect.succeed(null),
        rekey: () => Effect.dieMessage('rekey is not used'),
        hasOccurrence: () => Effect.succeed(false),
        hasOccurrences: () => Effect.succeed(new Set()),
        findByOccurrences: () => Effect.succeed([]),
        listByNodeIds: () => Effect.succeed([]),
        listByNodeIdsPage: () =>
          Effect.succeed({ resources: [], total: 0, nextCursor: null, orderRevision: 'none' }),
        listManagedNodeIds: () => Effect.succeed([]),
        getContentLocation: () => Effect.succeed(null),
        getBackfillCursor: () => Effect.succeed(-1),
        advanceBackfillCursor: () => Effect.void,
      }),
    ),
    Layer.succeed(
      SessionRepository,
      SessionRepository.of({
        list: () => Effect.succeed([]),
        listArchivedBranches: () => Effect.succeed([]),
        getTree: () => Effect.succeed(null),
        listResourceProjectionPage: () =>
          Effect.succeed({ nodes: [], throughCreatedOrder: null, hasMore: false }),
        getResourceProjectionNodes: () => Effect.succeed([]),
        getWorkspace: (sessionId) =>
          Effect.succeed(
            fromPartial<SessionWorkspace>({
              ...workspaceFor(sessionId),
              transcriptPath: [],
            }),
          ),
        persistSnapshot: () => Effect.void,
        updateRuntime: () => Effect.void,
        renameBranch: () => Effect.void,
        archiveBranch: () => Effect.void,
        restoreBranch: () => Effect.void,
        updateTreeUiState: () => Effect.void,
        recordActiveRun: () => Effect.void,
        clearActiveRun: () => Effect.void,
        clearInterruptedRuns: () => Effect.void,
        listActiveRunsForRecovery: () => Effect.succeed([]),
        markActiveRunInterrupted: () => Effect.void,
      }),
    ),
  )
}

describe('session Output recording', () => {
  it('records an idempotent change request and invalidates its exact session', async () => {
    const recorded: UpsertSessionResourceInput[] = []
    const invalidated = vi.fn()
    const unsubscribe = subscribeToSessionResourceInvalidations(invalidated)
    const layer = recordingLayer(recorded, () => ({
      activeBranchId: SessionBranchId('branch-main'),
      activeNodeId: SessionNodeId('node-current'),
    }))
    const request = {
      title: 'Add Session Summary',
      url: 'https://github.com/openwaggle/openwaggle/pull/42',
    }

    await Effect.runPromise(
      Effect.all([
        recordSessionChangeRequest(SessionId('session-1'), request),
        recordSessionChangeRequest(SessionId('session-1'), request),
      ]).pipe(Effect.provide(layer)),
    )
    unsubscribe()

    expect(recorded[0]).toMatchObject({
      sessionId: SessionId('session-1'),
      canonicalKey: 'url:https://github.com/openwaggle/openwaggle/pull/42',
      kind: 'change-request',
      title: 'Add Session Summary',
      locator: 'https://github.com/openwaggle/openwaggle/pull/42',
      occurrence: {
        actor: 'user',
        activity: 'created',
        nodeId: 'node-current',
        branchId: 'branch-main',
        locator: 'https://github.com/openwaggle/openwaggle/pull/42',
      },
    })
    expect(recorded[0]?.occurrence.id).toBe(recorded[1]?.occurrence.id)
    expect(invalidated).toHaveBeenCalledTimes(2)
    expect(invalidated).toHaveBeenNthCalledWith(1, { sessionId: SessionId('session-1') })
  })

  it('records the same commit independently in each owning session', async () => {
    const recorded: UpsertSessionResourceInput[] = []
    const invalidated = vi.fn()
    const unsubscribe = subscribeToSessionResourceInvalidations(invalidated)
    const layer = recordingLayer(recorded, (sessionId) => ({
      activeBranchId: SessionBranchId(`branch-${sessionId}`),
      activeNodeId: SessionNodeId(`node-${sessionId}`),
    }))

    await Effect.runPromise(
      Effect.all([
        recordSessionCommit(SessionId('session-1'), {
          commitHash: 'abc123',
          summary: 'Add the session summary',
        }),
        recordSessionCommit(SessionId('session-2'), {
          commitHash: 'abc123',
          summary: 'Add the session summary',
        }),
      ]).pipe(Effect.provide(layer)),
    )
    unsubscribe()

    expect(recorded.map((entry) => entry.sessionId)).toEqual([
      SessionId('session-1'),
      SessionId('session-2'),
    ])
    expect(recorded.every((entry) => entry.canonicalKey === 'commit:abc123')).toBe(true)
    expect(recorded.map((entry) => entry.occurrence.id)).toEqual([
      'created:commit:session-1:abc123',
      'created:commit:session-2:abc123',
    ])
    expect(recorded.map((entry) => entry.occurrence.locator)).toEqual([null, null])
    expect(invalidated.mock.calls.map(([event]) => event)).toEqual([
      { sessionId: SessionId('session-1') },
      { sessionId: SessionId('session-2') },
    ])
  })
})
