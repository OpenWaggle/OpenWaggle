import type { Message } from '@shared/types/agent'
import { MessageId, SessionBranchId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type { AgentTransportEvent } from '@shared/types/stream'
import type { WaggleConfig, WaggleStreamMetadata } from '@shared/types/waggle'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AgentKernelService,
  type AgentKernelWaggleRunInput,
} from '../../ports/agent-kernel-service'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { type PersistSessionSnapshotInput, SessionRepository } from '../../ports/session-repository'
import { SettingsService } from '../../services/settings-service'
import { executeWaggleRun } from '../waggle-run-service'

const runWaggleMock = vi.fn()
const persistSnapshotMock = vi.fn()
const recordActiveRunMock = vi.fn()
const clearActiveRunMock = vi.fn()
const clearInterruptedRunsMock = vi.fn()

const sessionId = SessionId('session-1')
const projectPath = '/tmp/openwaggle-project'

const session: SessionDetail = {
  id: sessionId,
  title: 'Existing session',
  projectPath,
  piSessionId: 'pi-session-1',
  piSessionFile: '/tmp/pi-session-1.jsonl',
  messages: [],
  createdAt: 1,
  updatedAt: 2,
}

const waggleConfig: WaggleConfig = {
  mode: 'sequential',
  agents: [
    {
      label: 'Architect',
      model: SupportedModelId('openai/gpt-5.4'),
      roleDescription: 'Plan the implementation',
      color: 'blue',
    },
    {
      label: 'Reviewer',
      model: SupportedModelId('anthropic/claude-sonnet-4-5'),
      roleDescription: 'Review the implementation',
      color: 'amber',
    },
  ],
  stop: { primary: 'consensus', maxTurnsSafety: 2 },
}

const assistantMessage: Message = {
  id: MessageId('assistant-message-1'),
  role: 'assistant',
  parts: [{ type: 'text', text: 'I inspected the project and found the right path.' }],
  model: SupportedModelId('openai/gpt-5.4'),
  createdAt: 10,
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

const TestSettingsLayer = Layer.succeed(SettingsService, {
  get: () =>
    Effect.succeed({
      ...DEFAULT_SETTINGS,
      skillTogglesByProject: {
        [projectPath]: {
          'code-review': false,
        },
      },
    }),
  update: () => Effect.void,
  initialize: () => Effect.void,
  flushForTests: () => Effect.void,
})

const TestSessionLayer = Layer.succeed(SessionRepository, {
  list: () => Effect.succeed([]),
  listArchivedBranches: () => Effect.succeed([]),
  getTree: () => Effect.succeed(null),
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
  listActiveRunsForRecovery: () => Effect.succeed([]),
  markActiveRunInterrupted: () => Effect.void,
})

const TestAgentKernelLayer = Layer.succeed(AgentKernelService, {
  createSession: () => Effect.fail(new Error('createSession is not used')),
  run: () => Effect.fail(new Error('standard run is not used')),
  runWaggle: (input: AgentKernelWaggleRunInput) =>
    Effect.promise(async () => {
      runWaggleMock(input)
      const meta = input.createTurnMetadata({ turnNumber: 0, agentIndex: 0 })
      input.onWaggleEvent(
        {
          type: 'message_update',
          messageId: 'assistant-node-1',
          role: 'assistant',
          assistantMessageEvent: {
            type: 'text_delta',
            contentIndex: 0,
            delta: 'I inspected',
          },
          timestamp: 10,
          model: meta.agentModel,
        },
        meta,
      )
      await input.onTurnComplete({
        meta,
        assistantMessages: [assistantMessage],
        responseText: 'I inspected the project and found the right path.',
        hasToolCalls: false,
      })
      return {
        newMessages: [assistantMessage],
        piSessionId: 'pi-session-1',
        piSessionFile: '/tmp/pi-session-1.jsonl',
        sessionSnapshot: {
          activeNodeId: 'assistant-node-1',
          nodes: [
            {
              id: 'assistant-node-1',
              parentId: null,
              piEntryType: 'message',
              kind: 'assistant_message',
              role: 'assistant',
              timestampMs: 10,
              contentJson: '{}',
              metadataJson: '{}',
              pathDepth: 0,
              createdOrder: 0,
            },
          ],
        },
      }
    }),
  getContextUsage: () => Effect.fail(new Error('context usage is not used')),
  compact: () => Effect.fail(new Error('compaction is not used')),
  navigateTree: () => Effect.fail(new Error('tree navigation is not used')),
  forkSession: () => Effect.fail(new Error('session fork is not used')),
  getSessionSnapshot: () => Effect.fail(new Error('session snapshot is not used')),
})

const TestLayer = Layer.mergeAll(
  TestSessionProjectionLayer,
  TestSettingsLayer,
  TestSessionLayer,
  TestAgentKernelLayer,
)

describe('executeWaggleRun', () => {
  beforeEach(() => {
    runWaggleMock.mockReset()
    persistSnapshotMock.mockReset()
    recordActiveRunMock.mockReset()
    clearActiveRunMock.mockReset()
    clearInterruptedRunsMock.mockReset()
  })

  it('delegates the full collaboration to a single Pi-native Waggle kernel run', async () => {
    const emitted: Array<{
      readonly event: AgentTransportEvent
      readonly meta: WaggleStreamMetadata
    }> = []

    const result = await Effect.runPromise(
      executeWaggleRun({
        sessionId,
        runId: 'run-waggle-1',
        payload: { text: 'Review the implementation', thinkingLevel: 'medium', attachments: [] },
        config: waggleConfig,
        signal: new AbortController().signal,
        onEvent: (event, meta) => emitted.push({ event, meta }),
        onTurnEvent: () => undefined,
      }).pipe(Effect.provide(TestLayer)),
    )

    expect(result.outcome).toBe('success')
    expect(runWaggleMock).toHaveBeenCalledOnce()
    const [runInput] = runWaggleMock.mock.calls[0] ?? []
    expect(runInput).toMatchObject({
      session,
      runId: 'run-waggle-1',
      config: waggleConfig,
      model: waggleConfig.agents[0].model,
      skillToggles: { 'code-review': false },
    })
    expect(recordActiveRunMock).toHaveBeenCalledWith({
      runId: 'run-waggle-1',
      sessionId,
      branchId: SessionBranchId('session-1:main'),
      runMode: 'waggle',
      model: waggleConfig.agents[0].model,
    })
    expect(clearInterruptedRunsMock).toHaveBeenCalledWith({
      sessionId,
      branchId: SessionBranchId('session-1:main'),
    })
    expect(emitted[0]?.meta.agentLabel).toBe('Architect')

    if (result.outcome !== 'success') {
      throw new Error('Expected successful Waggle result')
    }
    expect(result.newMessages[1]?.metadata?.waggle).toMatchObject({
      agentLabel: 'Architect',
      agentColor: 'blue',
      turnNumber: 0,
    })
    expect(persistSnapshotMock).toHaveBeenCalledOnce()
    expect(persistSnapshotMock.mock.calls[0]?.[0].nodes[0]?.metadataJson).toContain('Architect')
    expect(clearActiveRunMock).toHaveBeenCalledWith({ sessionId, runId: 'run-waggle-1' })
  })
})
