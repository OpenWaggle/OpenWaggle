import { SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentKernelMissingEntryError, AgentKernelService } from '../../ports/agent-kernel-service'
import { ProviderService } from '../../ports/provider-service'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { SessionRepository } from '../../ports/session-repository'
import { SettingsService } from '../../services/settings-service'
import {
  cloneAgentSessionToNewSession,
  compactAgentSession,
  forkAgentSessionToNewSession,
  navigateAgentSessionTree,
} from '../agent-session-service'

const persistSnapshotMock = vi.fn()
const compactMock = vi.fn()
const navigateTreeMock = vi.fn()
const forkSessionMock = vi.fn()
const createProjectionMock = vi.fn()
const getProjectionMock = vi.fn()

const session: SessionDetail = {
  id: SessionId('session-1'),
  title: 'Session 1',
  projectPath: '/tmp/project',
  piSessionId: 'pi-session-1',
  piSessionFile: '/tmp/pi-session-1.jsonl',
  messages: [],
  createdAt: 1,
  updatedAt: 2,
}

const forkedSession: SessionDetail = {
  id: SessionId('pi-session-forked'),
  title: 'New session',
  projectPath: '/tmp/project',
  piSessionId: 'pi-session-forked',
  piSessionFile: '/tmp/pi-session-forked.jsonl',
  messages: [],
  createdAt: 3,
  updatedAt: 4,
}

const TestSessionProjectionLayer = Layer.succeed(SessionProjectionRepository, {
  get: (id) =>
    Effect.sync(() => {
      getProjectionMock(id)
      return id === forkedSession.id ? forkedSession : session
    }),
  getOptional: () => Effect.succeed(session),
  list: () => Effect.succeed([]),
  listDetails: () => Effect.succeed([]),
  create: (input) =>
    Effect.sync(() => {
      createProjectionMock(input)
      return forkedSession
    }),
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
  getTree: () => Effect.succeed(null),
  getWorkspace: () => Effect.succeed(null),
  persistSnapshot: (input) =>
    Effect.sync(() => {
      persistSnapshotMock(input)
    }),
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

const TestAgentKernelLayer = Layer.succeed(AgentKernelService, {
  createSession: () => Effect.fail(new Error('createSession is not used')),
  run: () => Effect.fail(new Error('run is not used')),
  runWaggle: () => Effect.fail(new Error('runWaggle is not used')),
  getContextUsage: () => Effect.fail(new Error('getContextUsage is not used')),
  compact: (input) =>
    Effect.tryPromise({
      try: async () => compactMock(input),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }),
  navigateTree: (input) =>
    Effect.tryPromise({
      try: async () => navigateTreeMock(input),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }),
  forkSession: (input) =>
    Effect.tryPromise({
      try: async () => forkSessionMock(input),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }),
  getSessionSnapshot: () => Effect.fail(new Error('getSessionSnapshot is not used')),
})

const TestLayer = Layer.mergeAll(
  TestSessionProjectionLayer,
  TestProviderLayer,
  TestSettingsLayer,
  TestSessionLayer,
  TestAgentKernelLayer,
)

describe('agent session commands', () => {
  beforeEach(() => {
    persistSnapshotMock.mockReset()
    compactMock.mockReset()
    navigateTreeMock.mockReset()
    forkSessionMock.mockReset()
    createProjectionMock.mockReset()
    getProjectionMock.mockReset()
  })

  it('forwards manual compaction lifecycle events while persisting the compacted session snapshot', async () => {
    const events: unknown[] = []
    compactMock.mockImplementation(async (input) => {
      input.onEvent({
        type: 'compaction_start',
        reason: 'manual',
        timestamp: 10,
        model: SupportedModelId('openai/gpt-5.4'),
      })
      input.onEvent({
        type: 'compaction_end',
        reason: 'manual',
        result: {
          summary: 'Kept the active task context.',
          firstKeptEntryId: 'kept-user',
          tokensBefore: 123456,
        },
        aborted: false,
        willRetry: false,
        timestamp: 20,
        model: SupportedModelId('openai/gpt-5.4'),
      })
      return {
        summary: 'Kept the active task context.',
        firstKeptEntryId: 'kept-user',
        tokensBefore: 123456,
        piSessionId: 'pi-session-1',
        piSessionFile: '/tmp/pi-session-1.jsonl',
        sessionSnapshot: {
          activeNodeId: 'compaction-summary',
          nodes: [],
        },
      }
    })

    const result = await Effect.runPromise(
      compactAgentSession({
        sessionId: SessionId('session-1'),
        model: SupportedModelId('openai/gpt-5.4'),
        onEvent: (event) => events.push(event),
      }).pipe(Effect.provide(TestLayer)),
    )

    expect(result).toEqual({
      summary: 'Kept the active task context.',
      firstKeptEntryId: 'kept-user',
      tokensBefore: 123456,
    })
    expect(events.map((event) => event)).toMatchObject([
      { type: 'compaction_start', reason: 'manual' },
      { type: 'compaction_end', reason: 'manual', aborted: false },
    ])
    expect(persistSnapshotMock).toHaveBeenCalledWith({
      sessionId: SessionId('session-1'),
      nodes: [],
      activeNodeId: 'compaction-summary',
      piSessionId: 'pi-session-1',
      piSessionFile: '/tmp/pi-session-1.jsonl',
    })
  })

  it('passes the manual compaction cancellation signal to the kernel', async () => {
    const abortController = new AbortController()
    compactMock.mockResolvedValue({
      summary: 'Kept the active task context.',
      firstKeptEntryId: 'kept-user',
      tokensBefore: 123456,
      piSessionId: 'pi-session-1',
      piSessionFile: '/tmp/pi-session-1.jsonl',
      sessionSnapshot: {
        activeNodeId: 'compaction-summary',
        nodes: [],
      },
    })

    await Effect.runPromise(
      compactAgentSession({
        sessionId: SessionId('session-1'),
        model: SupportedModelId('openai/gpt-5.4'),
        signal: abortController.signal,
      }).pipe(Effect.provide(TestLayer)),
    )

    expect(compactMock).toHaveBeenCalledWith(
      expect.objectContaining({ signal: abortController.signal }),
    )
  })

  it('treats stale projected nodes that are missing from the Pi JSONL session as cancelled navigation', async () => {
    navigateTreeMock.mockRejectedValue(new AgentKernelMissingEntryError('stale-node'))

    const result = await Effect.runPromise(
      navigateAgentSessionTree({
        sessionId: SessionId('session-1'),
        model: SupportedModelId('openai/gpt-5.4'),
        targetNodeId: SessionNodeId('stale-node'),
      }).pipe(Effect.provide(TestLayer)),
    )

    expect(result).toEqual({ cancelled: true })
    expect(persistSnapshotMock).not.toHaveBeenCalled()
  })

  it('persists the returned Pi session snapshot after successful navigation', async () => {
    navigateTreeMock.mockResolvedValue({
      piSessionId: 'pi-session-1',
      piSessionFile: '/tmp/pi-session-1.jsonl',
      sessionSnapshot: {
        activeNodeId: 'target-node',
        nodes: [],
      },
      editorText: 'draft',
      cancelled: false,
    })

    const result = await Effect.runPromise(
      navigateAgentSessionTree({
        sessionId: SessionId('session-1'),
        model: SupportedModelId('openai/gpt-5.4'),
        targetNodeId: SessionNodeId('target-node'),
      }).pipe(Effect.provide(TestLayer)),
    )

    expect(result).toEqual({ editorText: 'draft', cancelled: false })
    expect(persistSnapshotMock).toHaveBeenCalledWith({
      sessionId: SessionId('session-1'),
      nodes: [],
      activeNodeId: 'target-node',
      piSessionId: 'pi-session-1',
      piSessionFile: '/tmp/pi-session-1.jsonl',
    })
  })

  it('forks a previous user message into a new projected session and prefills the editor text', async () => {
    forkSessionMock.mockResolvedValue({
      cancelled: false,
      editorText: 'retry this prompt',
      piSessionId: 'pi-session-forked',
      piSessionFile: '/tmp/pi-session-forked.jsonl',
      sessionSnapshot: {
        activeNodeId: 'parent-node',
        nodes: [],
      },
    })

    const result = await Effect.runPromise(
      forkAgentSessionToNewSession({
        sessionId: SessionId('session-1'),
        model: SupportedModelId('openai/gpt-5.4'),
        targetNodeId: SessionNodeId('user-node'),
      }).pipe(Effect.provide(TestLayer)),
    )

    expect(result).toEqual({
      cancelled: false,
      editorText: 'retry this prompt',
      session: forkedSession,
    })
    expect(forkSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        session,
        model: SupportedModelId('openai/gpt-5.4'),
        targetNodeId: 'user-node',
        position: 'before',
      }),
    )
    expect(createProjectionMock).toHaveBeenCalledWith({
      projectPath: '/tmp/project',
      piSessionId: 'pi-session-forked',
      piSessionFile: '/tmp/pi-session-forked.jsonl',
    })
    expect(persistSnapshotMock).toHaveBeenCalledWith({
      sessionId: SessionId('pi-session-forked'),
      nodes: [],
      activeNodeId: 'parent-node',
      piSessionId: 'pi-session-forked',
      piSessionFile: '/tmp/pi-session-forked.jsonl',
    })
    expect(getProjectionMock).toHaveBeenCalledWith(SessionId('pi-session-forked'))
  })

  it('clones the current node into a new projected session without editor prefill', async () => {
    forkSessionMock.mockResolvedValue({
      cancelled: false,
      piSessionId: 'pi-session-forked',
      piSessionFile: '/tmp/pi-session-forked.jsonl',
      sessionSnapshot: {
        activeNodeId: 'current-node',
        nodes: [],
      },
    })

    const result = await Effect.runPromise(
      cloneAgentSessionToNewSession({
        sessionId: SessionId('session-1'),
        model: SupportedModelId('openai/gpt-5.4'),
        targetNodeId: SessionNodeId('current-node'),
      }).pipe(Effect.provide(TestLayer)),
    )

    expect(result).toEqual({
      cancelled: false,
      session: forkedSession,
    })
    expect(forkSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targetNodeId: 'current-node',
        position: 'at',
      }),
    )
  })
})
