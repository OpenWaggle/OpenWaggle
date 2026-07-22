import { SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentKernelService } from '../../ports/agent-kernel-service'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { SessionRepository } from '../../ports/session-repository'
import {
  cloneAgentSessionToNewSession,
  forkAgentSessionToNewSession,
} from '../agent-session-service'
import {
  sessionServiceForkedSession,
  sessionServiceProviderLayer,
  sessionServiceSession,
  sessionServiceSettingsLayer,
} from './agent-session-service.test-utils'
import { EmptyExtensionRuntimeLayer } from './extension-runtime-test-layer'

const persistSnapshotMock = vi.fn()
const forkSessionMock = vi.fn()
const createProjectionMock = vi.fn()
const getProjectionMock = vi.fn()

const session = sessionServiceSession
const forkedSession = sessionServiceForkedSession

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
  getContextUsage: () => Effect.fail(new Error('getContextUsage is not used')),
  compact: () => Effect.fail(new Error('compact is not used')),
  navigateTree: () => Effect.fail(new Error('navigateTree is not used')),
  forkSession: (input) =>
    Effect.tryPromise({
      try: async () => forkSessionMock(input),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }),
  getSessionSnapshot: () => Effect.fail(new Error('getSessionSnapshot is not used')),
})

const TestLayer = Layer.mergeAll(
  TestSessionProjectionLayer,
  sessionServiceProviderLayer,
  sessionServiceSettingsLayer,
  TestSessionLayer,
  TestAgentKernelLayer,
  EmptyExtensionRuntimeLayer,
)

describe('agent session copy commands', () => {
  beforeEach(() => {
    persistSnapshotMock.mockReset()
    forkSessionMock.mockReset()
    createProjectionMock.mockReset()
    getProjectionMock.mockReset()
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
