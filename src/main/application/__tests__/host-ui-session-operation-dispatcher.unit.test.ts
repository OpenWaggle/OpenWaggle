import { SessionId } from '@shared/types/brand'
import { HOST_BACKED_GUI_CHANNELS } from '@shared/types/host-ui-protocol'
import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionRepository } from '../../ports/session-repository'
import { emptySessionCatalogMethods } from './session-repository-test-support'

const { dispatchLocalSessionCommandMock } = vi.hoisted(() => ({
  dispatchLocalSessionCommandMock: vi.fn(),
}))

vi.mock('../local-session-command-dispatcher', () => ({
  dispatchLocalSessionCommand: dispatchLocalSessionCommandMock,
}))

vi.mock('../../agent/session-cleanup', () => ({ cleanupSessionRun: vi.fn() }))
vi.mock('../../utils/stream-bridge', () => ({
  clearAgentPhase: vi.fn(),
  clearStreamBuffer: vi.fn(),
  emitRunCompleted: vi.fn(),
}))

import {
  dispatchHostBackedSessionGuiOperation,
  isHostBackedSessionGuiChannel,
} from '../host-ui-session-operation-dispatcher'

const EXPECTED_SESSION_CHANNELS = [
  'sessions:get-detail',
  'sessions:create',
  'sessions:fork-to-new',
  'sessions:clone-to-new',
  'sessions:dismiss-interrupted-run',
  'sessions:delete',
  'sessions:archive',
  'sessions:unarchive',
  'sessions:update-title',
  'sessions:set-authorization-mode',
  'sessions:list-by-ids',
  'sessions:list-page',
  'sessions:list-hive-page',
  'sessions:list-archived-branches',
  'sessions:get-tree',
  'sessions:get-workspace',
  'sessions:navigate-tree',
  'sessions:rename-branch',
  'sessions:archive-branch',
  'sessions:restore-branch',
  'sessions:update-tree-ui-state',
  'sessions:turn-checkpoints:list',
  'sessions:turn-diff:get',
  'sessions:pins:list',
  'sessions:pins:pin',
  'sessions:pins:unpin',
  'sessions:pins:move',
] as const

const sessionRepository = SessionRepository.of({
  ...emptySessionCatalogMethods,
  list: (limit) =>
    Effect.succeed([
      {
        id: SessionId('session-1'),
        title: `Session ${String(limit)}`,
        projectPath: '/tmp/project',
        createdAt: 1,
        updatedAt: 2,
      },
    ]),
  listArchivedBranches: () => Effect.succeed([]),
  listArchivedBranchCatalogPage: (limit, cursor) =>
    Effect.succeed({
      sessions: [
        {
          id: SessionId('session-archived-branch'),
          title: `Archived branches ${String(limit)}`,
          projectPath: cursor ?? null,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    }),
  getTree: () => Effect.succeed(null),
  getWorkspace: () => Effect.succeed(null),
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
})

function runWithoutRequirements<A>(effect: Effect.Effect<A, unknown, unknown>): Promise<A> {
  const runnableEffect = fromAny<Effect.Effect<A, unknown, never>, typeof effect>(effect)
  return Effect.runPromise(runnableEffect)
}

describe('Host-backed Session GUI operation dispatcher', () => {
  beforeEach(() => {
    dispatchLocalSessionCommandMock.mockReset().mockReturnValue(
      Effect.succeed({
        contract: 'local-ui-v1',
        response: {
          requestId: 'request-ui',
          effect: 'pinned',
          sessionId: 'session-1',
        },
      }),
    )
  })

  it('covers the complete Session subset of the shared Host UI protocol', () => {
    expect(HOST_BACKED_GUI_CHANNELS.filter(isHostBackedSessionGuiChannel)).toEqual(
      EXPECTED_SESSION_CHANNELS,
    )
  })

  it('dispatches archived branch catalog pages with a bounded cursor', async () => {
    const effect = dispatchHostBackedSessionGuiOperation('sessions:list-archived-branches', [
      100,
      'next-page',
    ]).pipe(Effect.provideService(SessionRepository, sessionRepository))

    await expect(runWithoutRequirements(effect)).resolves.toEqual({
      sessions: [
        expect.objectContaining({
          id: SessionId('session-archived-branch'),
          title: 'Archived branches 100',
          projectPath: 'next-page',
        }),
      ],
    })
  })

  it('executes Local UI mutations independently from Electron IPC', async () => {
    await expect(
      runWithoutRequirements(
        dispatchHostBackedSessionGuiOperation('sessions:pins:pin', [SessionId('session-1')]),
      ),
    ).resolves.toEqual(expect.objectContaining({ effect: 'pinned' }))

    expect(dispatchLocalSessionCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          request: expect.objectContaining({
            command: { operation: 'pin', sessionId: SessionId('session-1') },
          }),
        }),
      }),
    )
  })

  it('rejects malformed Host arguments before resolving persistence services', async () => {
    await expect(
      runWithoutRequirements(
        dispatchHostBackedSessionGuiOperation('sessions:update-tree-ui-state', [
          SessionId('session-1'),
          { expandedNodeIds: [''] },
        ]),
      ),
    ).rejects.toThrow('Session node ID must be a non-empty string.')
  })
})
