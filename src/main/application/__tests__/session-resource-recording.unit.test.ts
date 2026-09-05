import { SessionId } from '@shared/types/brand'
import type { SessionWorkspace } from '@shared/types/session'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import { SessionRepository } from '../../ports/session-repository'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { SessionResourceRepository } from '../../ports/session-resource-repository'
import { recordSessionChangeRequest, recordSessionCommit } from '../session-resource-recording'

describe('recordSessionChangeRequest', () => {
  it('records a created change request as an output of the opened session', async () => {
    const recorded: UpsertSessionResourceInput[] = []
    const layer = Layer.mergeAll(
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
                activeBranchId: 'branch-main',
                activeNodeId: 'node-current',
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
      },
    })
    expect(recorded[0]?.occurrence.id).toBe(recorded[1]?.occurrence.id)
  })

  it('records the same commit independently in each originating session', async () => {
    const recorded: UpsertSessionResourceInput[] = []
    const repositoryLayer = Layer.succeed(
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
        findByCanonicalKey: () => Effect.succeed(null),
        rekey: () => Effect.dieMessage('rekey is not used'),
        hasOccurrence: () => Effect.succeed(false),
        getContentLocation: () => Effect.succeed(null),
        getBackfillCursor: () => Effect.succeed(-1),
        advanceBackfillCursor: () => Effect.void,
      }),
    )
    const sessionsLayer = Layer.succeed(
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
              activeBranchId: `branch-${sessionId}`,
              activeNodeId: `node-${sessionId}`,
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
    )
    const layer = Layer.merge(repositoryLayer, sessionsLayer)

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

    expect(recorded).toHaveLength(2)
    expect(recorded.map((entry) => entry.sessionId)).toEqual([
      SessionId('session-1'),
      SessionId('session-2'),
    ])
    expect(recorded.every((entry) => entry.canonicalKey === 'commit:abc123')).toBe(true)
    expect(recorded.every((entry) => entry.kind === 'commit')).toBe(true)
    expect(recorded.map((entry) => entry.occurrence.id)).toEqual([
      'created:commit:session-1:abc123',
      'created:commit:session-2:abc123',
    ])
  })
})
