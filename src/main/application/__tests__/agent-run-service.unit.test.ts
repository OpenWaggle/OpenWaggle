import { SupportedModelId } from '@shared/types/brand'
import type { SessionContentTree, SessionDetail } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PINNED_SESSION_REPOSITORY_STUB } from '../../ports/__tests__/session-projection-pin-stub'
import { type AgentKernelRunInput, AgentKernelService } from '../../ports/agent-kernel-service'
import { ProviderService } from '../../ports/provider-service'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import {
  type PersistSessionActiveRunInput,
  type PersistSessionSnapshotInput,
  SessionRepository,
} from '../../ports/session-repository'
import { SettingsService } from '../../services/settings-service'
import { executeAgentRun, reconcileInterruptedAgentRuns } from '../agent-run-service'
import {
  runServiceBranchId,
  runServiceKernelResult,
  runServiceNewSession,
  runServiceRecoveredSnapshot,
  runServiceSession,
  runServiceSessionId,
  runServiceSessionTree,
} from './agent-run-service.test-utils'
import { EmptyExtensionRuntimeLayer } from './extension-runtime-test-layer'
import { emptySessionCatalogMethods } from './session-repository-test-support'

const runMock = vi.fn()
const updateTitleMock = vi.fn()
const persistSnapshotMock = vi.fn()
const clearInterruptedRunsMock = vi.fn()
const getSessionSnapshotMock = vi.fn()

const sessionId = runServiceSessionId
const branchId = runServiceBranchId
const model = SupportedModelId('openai/gpt-5.4')
const session = runServiceSession
const newSession = runServiceNewSession

/** The durable active-run rows, keyed by Run id, as the repository stores them. */
const activeRunRows = new Map<
  string,
  PersistSessionActiveRunInput & { status: 'active' | 'interrupted' }
>()

let projectionSession: SessionDetail = session
let projectionTree: SessionContentTree = runServiceSessionTree
const TestSessionProjectionLayer = Layer.succeed(SessionProjectionRepository, {
  get: () => Effect.succeed(projectionSession),
  getOptional: () => Effect.succeed(projectionSession),
  list: () => Effect.succeed([]),
  listDetails: () => Effect.succeed([]),
  create: () => Effect.succeed(session),
  delete: () => Effect.void,
  archive: () => Effect.void,
  unarchive: () => Effect.void,
  listArchived: () => Effect.succeed([]),
  updateTitle: () => Effect.void,
  assignProvisionalTitle: (id, title) =>
    Effect.sync(() => {
      updateTitleMock(id, title)
      return true
    }),
  setWorktreePlan: () => Effect.void,
  setAuthorizationMode: () => Effect.void,
  listTurnCheckpoints: () => Effect.succeed([]),
  getTurnDiff: () => Effect.succeed(null),
  getTurnDiffFiles: () => Effect.succeed([]),
  listTurnDiffFiles: () => Effect.succeed({}),
  setTurnCheckpointAnchor: () => Effect.void,
  ...PINNED_SESSION_REPOSITORY_STUB,
})
const TestProviderLayer = Layer.succeed(ProviderService, {
  get: () => Effect.succeed(undefined),
  getAll: () => Effect.succeed([]),
  getProviderForModel: () => Effect.dieMessage('getProviderForModel is not used'),
  isKnownModel: () => Effect.succeed(true),
})
const TestSettingsLayer = Layer.succeed(SettingsService, {
  get: () => Effect.succeed(DEFAULT_SETTINGS),
  update: () => Effect.void,
  initialize: () => Effect.void,
  flushForTests: () => Effect.void,
})

const TestSessionLayer = Layer.succeed(SessionRepository, {
  ...emptySessionCatalogMethods,
  list: () => Effect.succeed([]),
  listArchivedBranches: () => Effect.succeed([]),
  getTree: () => Effect.succeed(projectionTree),
  listResourceProjectionPage: () =>
    Effect.succeed({ nodes: [], throughCreatedOrder: null, hasMore: false }),
  getResourceProjectionNodes: () => Effect.succeed([]),
  getWorkspace: () => Effect.succeed(null),
  persistSnapshot: (input: PersistSessionSnapshotInput) =>
    Effect.sync(() => {
      persistSnapshotMock(input)
    }),
  updateRuntime: () => Effect.void,
  renameBranch: () => Effect.void,
  archiveBranch: () => Effect.void,
  restoreBranch: () => Effect.void,
  updateTreeUiState: () => Effect.void,
  recordActiveRun: (input) =>
    Effect.sync(() => {
      activeRunRows.set(input.runId, { ...input, status: 'active' })
    }),
  clearActiveRun: (input) =>
    Effect.sync(() => {
      if (activeRunRows.get(input.runId)?.sessionId === input.sessionId) {
        activeRunRows.delete(input.runId)
      }
    }),
  clearInterruptedRuns: (input) =>
    Effect.sync(() => {
      clearInterruptedRunsMock(input)
    }),
  listActiveRunsForRecovery: () =>
    Effect.sync(() =>
      [...activeRunRows.values()]
        .filter((row) => row.status === 'active')
        .map(({ status: _status, ...row }) => row),
    ),
  markActiveRunInterrupted: (input) =>
    Effect.sync(() => {
      const row = activeRunRows.get(input.runId)
      if (row?.sessionId === input.sessionId) row.status = 'interrupted'
    }),
})

const TestAgentKernelLayer = Layer.succeed(AgentKernelService, {
  createSession: () => Effect.fail(new Error('createSession is not used')),
  run: (input: AgentKernelRunInput) =>
    Effect.tryPromise({
      try: async () => {
        runMock(input)
        return runServiceKernelResult(model)
      },
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }),
  getContextUsage: () => Effect.fail(new Error('getContextUsage is not used')),
  listExtensionCommands: () => Effect.succeed([]),
  compact: () => Effect.fail(new Error('compact is not used')),
  navigateTree: () => Effect.fail(new Error('navigateTree is not used')),
  forkSession: () => Effect.fail(new Error('forkSession is not used')),
  getSessionSnapshot: (input) =>
    Effect.sync(() => {
      getSessionSnapshotMock(input)
      return runServiceRecoveredSnapshot
    }),
})

const TestLayer = Layer.mergeAll(
  TestSessionProjectionLayer,
  TestProviderLayer,
  TestSettingsLayer,
  TestSessionLayer,
  TestAgentKernelLayer,
  EmptyExtensionRuntimeLayer,
)

describe('executeAgentRun', () => {
  beforeEach(() => {
    projectionSession = session
    projectionTree = runServiceSessionTree
    runMock.mockReset()
    updateTitleMock.mockReset()
    persistSnapshotMock.mockReset()
    activeRunRows.clear()
    clearInterruptedRunsMock.mockReset()
    getSessionSnapshotMock.mockReset()
  })

  it('records and clears the durable active run around a Pi standard run', async () => {
    let rowsDuringRun: unknown[] = []
    runMock.mockImplementationOnce(() => {
      rowsDuringRun = [...activeRunRows.values()]
    })
    const result = await Effect.runPromise(
      executeAgentRun({
        sessionId,
        runId: 'run-standard-1',
        payload: { text: 'Implement the next slice', attachments: [] },
        model,
        signal: new AbortController().signal,
        onEvent: () => undefined,
      }).pipe(Effect.provide(TestLayer)),
    )

    expect(result.outcome).toBe('success')
    expect(clearInterruptedRunsMock).toHaveBeenCalledWith({ sessionId, branchId })
    expect(rowsDuringRun).toEqual([
      { runId: 'run-standard-1', sessionId, branchId, runMode: 'classic', model, status: 'active' },
    ])
    expect(runMock.mock.calls[0]?.[0]).toMatchObject({
      runId: 'run-standard-1',
      compactionThresholdPercent: 80,
    })
    expect(persistSnapshotMock).toHaveBeenCalledOnce()
    expect(activeRunRows.size).toBe(0)
  })

  it("hands Pi the Session's stored thinking level, not one from the message", async () => {
    // The level a `message` or `start` set is stored with the Run's admission; the Run reads it here.
    projectionSession = { ...session, executionThinkingLevel: 'high' }

    await Effect.runPromise(
      executeAgentRun({
        sessionId,
        runId: 'run-thinking',
        payload: { text: 'Think hard', attachments: [] },
        model,
        signal: new AbortController().signal,
        onEvent: () => undefined,
      }).pipe(Effect.provide(TestLayer)),
    )

    const kernelInput = runMock.mock.calls.at(-1)?.[0]
    expect(kernelInput?.session.executionThinkingLevel).toBe('high')
    expect(kernelInput?.payload).not.toHaveProperty('thinkingLevel')
  })

  it('reports cancellation during first-send worktree creation as aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    runMock.mockImplementationOnce(() => controller.signal.throwIfAborted())

    const result = await Effect.runPromise(
      executeAgentRun({
        sessionId,
        runId: 'run-cancelled-worktree',
        payload: { text: 'Start in a worktree', attachments: [] },
        model,
        signal: controller.signal,
        onEvent: () => undefined,
      }).pipe(Effect.provide(TestLayer)),
    )

    expect(result).toEqual({ outcome: 'aborted' })
    expect(activeRunRows.size).toBe(0)
  })

  it('notifies immediately when a first user message assigns a session title', async () => {
    projectionSession = newSession
    const order: string[] = []
    runMock.mockImplementationOnce(() => {
      order.push('run')
    })

    const result = await Effect.runPromise(
      executeAgentRun({
        sessionId,
        runId: 'run-title-1',
        payload: {
          text: 'Draft a one-page summary of this app',
          attachments: [],
        },
        model,
        signal: new AbortController().signal,
        onEvent: () => undefined,
        onTitleAssigned: (title) => {
          order.push(`title:${title}`)
        },
      }).pipe(Effect.provide(TestLayer)),
    )

    expect(result).toEqual(
      expect.objectContaining({
        outcome: 'success',
        assignedTitle: 'Draft a one-page summary of this app',
      }),
    )
    expect(updateTitleMock).toHaveBeenCalledWith(sessionId, 'Draft a one-page summary of this app')
    expect(order).toEqual(['title:Draft a one-page summary of this app', 'run'])
  })

  it('reprojects and marks durable active runs as interrupted on startup', async () => {
    activeRunRows.set('run-recovery-1', {
      runId: 'run-recovery-1',
      sessionId,
      branchId,
      runMode: 'classic',
      model,
      status: 'active',
    })

    await Effect.runPromise(reconcileInterruptedAgentRuns().pipe(Effect.provide(TestLayer)))

    expect(getSessionSnapshotMock).toHaveBeenCalledWith({
      session,
      model,
      enabledOpenWaggleExtensionPackagePaths: [],
    })
    // The Session is reprojected from Pi's recovered snapshot, not left at its pre-Run state.
    const recovered = runServiceRecoveredSnapshot
    expect(persistSnapshotMock).toHaveBeenCalledExactlyOnceWith({
      sessionId,
      nodes: recovered.sessionSnapshot.nodes,
      activeNodeId: recovered.sessionSnapshot.activeNodeId,
      piSessionId: recovered.piSessionId,
      piSessionFile: recovered.piSessionFile,
    })
    expect(activeRunRows.get('run-recovery-1')?.status).toBe('interrupted')
  })
})
