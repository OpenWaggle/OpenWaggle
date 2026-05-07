import { MessageId, SessionBranchId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail, SessionTree } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type AgentKernelRunInput, AgentKernelService } from '../../ports/agent-kernel-service'
import { ProviderService } from '../../ports/provider-service'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { type PersistSessionSnapshotInput, SessionRepository } from '../../ports/session-repository'
import { SettingsService } from '../../services/settings-service'
import { executeAgentRun, reconcileInterruptedAgentRuns } from '../agent-run-service'

const runMock = vi.fn()
const persistSnapshotMock = vi.fn()
const recordActiveRunMock = vi.fn()
const clearActiveRunMock = vi.fn()
const clearInterruptedRunsMock = vi.fn()
const listActiveRunsForRecoveryMock = vi.fn()
const markActiveRunInterruptedMock = vi.fn()
const getSessionSnapshotMock = vi.fn()

const sessionId = SessionId('session-1')
const branchId = SessionBranchId('session-1:main')
const model = SupportedModelId('openai/gpt-5.4')

const session: SessionDetail = {
  id: sessionId,
  title: 'Existing session',
  projectPath: '/tmp/project',
  piSessionId: 'pi-session-1',
  piSessionFile: '/tmp/pi-session-1.jsonl',
  messages: [
    {
      id: MessageId('user-previous'),
      role: 'user',
      parts: [{ type: 'text', text: 'Existing prompt' }],
      createdAt: 1,
    },
  ],
  createdAt: 1,
  updatedAt: 2,
}

const sessionTree: SessionTree = {
  session: {
    id: sessionId,
    title: 'Existing session',
    projectPath: '/tmp/project',
    createdAt: 1,
    updatedAt: 2,
    lastActiveNodeId: null,
    lastActiveBranchId: branchId,
  },
  nodes: [],
  branches: [
    {
      id: branchId,
      sessionId,
      sourceNodeId: null,
      headNodeId: null,
      name: 'main',
      isMain: true,
      archivedAt: null,
      createdAt: 1,
      updatedAt: 2,
    },
  ],
  branchStates: [],
  uiState: null,
}

const TestSessionProjectionLayer = Layer.succeed(SessionProjectionRepository, {
  get: () => Effect.succeed(session),
  getOptional: () => Effect.succeed(session),
  list: () => Effect.succeed([]),
  listDetails: () => Effect.succeed([]),
  create: () => Effect.succeed(session),
  delete: () => Effect.void,
  archive: () => Effect.void,
  unarchive: () => Effect.void,
  listArchived: () => Effect.succeed([]),
  updateTitle: () => Effect.void,
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
  list: () => Effect.succeed([]),
  listArchivedBranches: () => Effect.succeed([]),
  getTree: () => Effect.succeed(sessionTree),
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
      recordActiveRunMock(input)
    }),
  clearActiveRun: (input) =>
    Effect.sync(() => {
      clearActiveRunMock(input)
    }),
  clearInterruptedRuns: (input) =>
    Effect.sync(() => {
      clearInterruptedRunsMock(input)
    }),
  listActiveRunsForRecovery: () => Effect.sync(() => listActiveRunsForRecoveryMock()),
  markActiveRunInterrupted: (input) =>
    Effect.sync(() => {
      markActiveRunInterruptedMock(input)
    }),
})

const TestAgentKernelLayer = Layer.succeed(AgentKernelService, {
  createSession: () => Effect.fail(new Error('createSession is not used')),
  run: (input: AgentKernelRunInput) =>
    Effect.promise(async () => {
      runMock(input)
      return {
        newMessages: [
          {
            id: MessageId('assistant-1'),
            role: 'assistant',
            parts: [{ type: 'text', text: 'Done' }],
            model,
            createdAt: 3,
          },
        ],
        piSessionId: 'pi-session-1',
        piSessionFile: '/tmp/pi-session-1.jsonl',
        sessionSnapshot: {
          activeNodeId: 'assistant-1',
          nodes: [
            {
              id: 'assistant-1',
              parentId: null,
              piEntryType: 'message',
              kind: 'assistant_message',
              role: 'assistant',
              timestampMs: 3,
              contentJson: '{}',
              metadataJson: '{}',
              pathDepth: 0,
              createdOrder: 0,
            },
          ],
        },
      }
    }),
  runWaggle: () => Effect.fail(new Error('runWaggle is not used')),
  getContextUsage: () => Effect.fail(new Error('getContextUsage is not used')),
  compact: () => Effect.fail(new Error('compact is not used')),
  navigateTree: () => Effect.fail(new Error('navigateTree is not used')),
  forkSession: () => Effect.fail(new Error('forkSession is not used')),
  getSessionSnapshot: (input) =>
    Effect.sync(() => {
      getSessionSnapshotMock(input)
      return {
        piSessionId: 'pi-session-1',
        piSessionFile: '/tmp/pi-session-1.jsonl',
        sessionSnapshot: {
          activeNodeId: 'assistant-recovered',
          nodes: [
            {
              id: 'assistant-recovered',
              parentId: null,
              piEntryType: 'message',
              kind: 'assistant_message',
              role: 'assistant',
              timestampMs: 4,
              contentJson: '{}',
              metadataJson: '{}',
              pathDepth: 0,
              createdOrder: 0,
            },
          ],
        },
      }
    }),
})

const TestLayer = Layer.mergeAll(
  TestSessionProjectionLayer,
  TestProviderLayer,
  TestSettingsLayer,
  TestSessionLayer,
  TestAgentKernelLayer,
)

describe('executeAgentRun', () => {
  beforeEach(() => {
    runMock.mockReset()
    persistSnapshotMock.mockReset()
    recordActiveRunMock.mockReset()
    clearActiveRunMock.mockReset()
    clearInterruptedRunsMock.mockReset()
    listActiveRunsForRecoveryMock.mockReset()
    listActiveRunsForRecoveryMock.mockReturnValue([])
    markActiveRunInterruptedMock.mockReset()
    getSessionSnapshotMock.mockReset()
  })

  it('records and clears the durable active run around a Pi standard run', async () => {
    const result = await Effect.runPromise(
      executeAgentRun({
        sessionId,
        runId: 'run-standard-1',
        payload: { text: 'Implement the next slice', thinkingLevel: 'medium', attachments: [] },
        model,
        signal: new AbortController().signal,
        onEvent: () => undefined,
      }).pipe(Effect.provide(TestLayer)),
    )

    expect(result.outcome).toBe('success')
    expect(clearInterruptedRunsMock).toHaveBeenCalledWith({ sessionId, branchId })
    expect(recordActiveRunMock).toHaveBeenCalledWith({
      runId: 'run-standard-1',
      sessionId,
      branchId,
      runMode: 'classic',
      model,
    })
    expect(runMock.mock.calls[0]?.[0]).toMatchObject({ runId: 'run-standard-1' })
    expect(persistSnapshotMock).toHaveBeenCalledOnce()
    expect(clearActiveRunMock).toHaveBeenCalledWith({
      sessionId,
      runId: 'run-standard-1',
    })
  })

  it('reprojects and marks durable active runs as interrupted on startup', async () => {
    listActiveRunsForRecoveryMock.mockReturnValue([
      {
        runId: 'run-recovery-1',
        sessionId,
        branchId,
        runMode: 'classic',
        model,
      },
    ])

    await Effect.runPromise(reconcileInterruptedAgentRuns().pipe(Effect.provide(TestLayer)))

    expect(getSessionSnapshotMock).toHaveBeenCalledWith({
      session,
      model,
    })
    expect(persistSnapshotMock).toHaveBeenCalledWith({
      sessionId,
      nodes: [
        {
          id: 'assistant-recovered',
          parentId: null,
          piEntryType: 'message',
          kind: 'assistant_message',
          role: 'assistant',
          timestampMs: 4,
          contentJson: '{}',
          metadataJson: '{}',
          pathDepth: 0,
          createdOrder: 0,
        },
      ],
      activeNodeId: 'assistant-recovered',
      piSessionId: 'pi-session-1',
      piSessionFile: '/tmp/pi-session-1.jsonl',
    })
    expect(markActiveRunInterruptedMock).toHaveBeenCalledWith({
      sessionId,
      runId: 'run-recovery-1',
    })
  })
})
