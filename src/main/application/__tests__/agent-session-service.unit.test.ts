import { ConversationId, SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentKernelMissingEntryError, AgentKernelService } from '../../ports/agent-kernel-service'
import { ProviderService } from '../../ports/provider-service'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { SessionRepository } from '../../ports/session-repository'
import { SettingsService } from '../../services/settings-service'
import { compactAgentSession, navigateAgentSessionTree } from '../agent-session-service'

const persistSnapshotMock = vi.fn()
const compactMock = vi.fn()
const navigateTreeMock = vi.fn()

const conversation: Conversation = {
  id: ConversationId('session-1'),
  title: 'Session 1',
  projectPath: '/tmp/project',
  piSessionId: 'pi-session-1',
  piSessionFile: '/tmp/pi-session-1.jsonl',
  messages: [],
  createdAt: 1,
  updatedAt: 2,
}

const TestConversationLayer = Layer.succeed(SessionProjectionRepository, {
  get: () => Effect.succeed(conversation),
  getOptional: () => Effect.succeed(conversation),
  list: () => Effect.succeed([]),
  listFull: () => Effect.succeed([]),
  create: () => Effect.succeed(conversation),
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
  getTree: () => Effect.succeed(null),
  getWorkspace: () => Effect.succeed(null),
  persistSnapshot: (input) =>
    Effect.sync(() => {
      persistSnapshotMock(input)
    }),
  updateRuntime: () => Effect.void,
})

const TestAgentKernelLayer = Layer.succeed(AgentKernelService, {
  createSession: () => Effect.fail(new Error('createSession is not used')),
  run: () => Effect.fail(new Error('run is not used')),
  runWaggleTurn: () => Effect.fail(new Error('runWaggleTurn is not used')),
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
})

const TestLayer = Layer.mergeAll(
  TestConversationLayer,
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
        conversationId: ConversationId('session-1'),
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
        conversationId: ConversationId('session-1'),
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
        conversationId: ConversationId('session-1'),
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
        conversationId: ConversationId('session-1'),
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
})
