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
  record: (input: UpsertSessionResourceInput) => void,
  workspace: Pick<SessionWorkspace, 'activeBranchId' | 'activeNodeId'> = {
    activeBranchId: SessionBranchId('branch-main'),
    activeNodeId: SessionNodeId('node-current'),
  },
) {
  return Layer.mergeAll(
    Layer.succeed(
      SessionResourceRepository,
      SessionResourceRepository.of({
        upsert: (input) => {
          record(input)
          return Effect.succeed({
            ...input,
            occurrences: [input.occurrence],
            isSource: false,
            isOutput: true,
          })
        },
        list: () => Effect.succeed([]),
        findByCanonicalKey: () => Effect.succeed(null),
        rekey: () => Effect.dieMessage('rekey is not used'),
        hasOccurrence: () => Effect.succeed(false),
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
        getWorkspace: () =>
          Effect.succeed(
            fromPartial<SessionWorkspace>({
              ...workspace,
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

describe('recordSessionChangeRequest', () => {
  it('records a created change request as an output of the opened session', async () => {
    let recorded: UpsertSessionResourceInput | null = null
    const invalidated = vi.fn()
    const unsubscribe = subscribeToSessionResourceInvalidations(invalidated)
    const layer = recordingLayer((input) => {
      recorded = input
    })

    await Effect.runPromise(
      recordSessionChangeRequest(SessionId('session-1'), {
        title: 'Add Session Summary',
        url: 'https://github.com/openwaggle/openwaggle/pull/42',
      }).pipe(Effect.provide(layer)),
    )
    unsubscribe()

    expect(recorded).toMatchObject({
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
      },
    })
    expect(invalidated).toHaveBeenCalledOnce()
    expect(invalidated).toHaveBeenCalledWith({ sessionId: SessionId('session-1') })
  })
})

describe('recordSessionCommit', () => {
  it('records a commit as an output on the owning session active branch and node', async () => {
    let recorded: UpsertSessionResourceInput | null = null
    const invalidated = vi.fn()
    const unsubscribe = subscribeToSessionResourceInvalidations(invalidated)
    const layer = recordingLayer((input) => {
      recorded = input
    })

    await Effect.runPromise(
      recordSessionCommit(SessionId('session-commit-owner'), {
        commitHash: '0123456789abcdef0123456789abcdef01234567',
        title: 'Keep commit output session-scoped',
      }).pipe(Effect.provide(layer)),
    )
    unsubscribe()

    expect(recorded).toMatchObject({
      sessionId: SessionId('session-commit-owner'),
      canonicalKey: 'git-commit:0123456789abcdef0123456789abcdef01234567',
      kind: 'commit',
      title: 'Keep commit output session-scoped',
      locator: null,
      occurrence: {
        actor: 'user',
        activity: 'created',
        nodeId: 'node-current',
        branchId: 'branch-main',
      },
    })
    expect(invalidated).toHaveBeenCalledOnce()
    expect(invalidated).toHaveBeenCalledWith({
      sessionId: SessionId('session-commit-owner'),
    })
  })
})
