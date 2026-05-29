import type { Message } from '@shared/types/agent'
import { MessageId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type { WaggleConfig } from '@shared/types/waggle'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { type Mock, vi } from 'vitest'
import { type AgentKernelRunInput, AgentKernelService } from '../../ports/agent-kernel-service'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { type PersistSessionSnapshotInput, SessionRepository } from '../../ports/session-repository'
import { SettingsService } from '../../services/settings-service'

export const runMock: Mock = vi.fn()
export const persistSnapshotMock: Mock = vi.fn()
export const recordActiveRunMock: Mock = vi.fn()
export const clearActiveRunMock: Mock = vi.fn()
export const clearInterruptedRunsMock: Mock = vi.fn()

export const sessionId = SessionId('session-1')
export const projectPath = '/tmp/openwaggle-project'
export const selectedModel = SupportedModelId('openai/gpt-5.4')

export const session: SessionDetail = {
  id: sessionId,
  title: 'Existing session',
  projectPath,
  piSessionId: 'pi-session-1',
  piSessionFile: '/tmp/pi-session-1.jsonl',
  messages: [],
  createdAt: 1,
  updatedAt: 2,
}

export const waggleConfig: WaggleConfig = {
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
  model: selectedModel,
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
      selectedModel,
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
  run: (input: AgentKernelRunInput) =>
    Effect.promise(async () => {
      runMock(input)
      if (!input.waggle) throw new Error('Expected Waggle run options')
      const meta = {
        agentIndex: 0,
        agentLabel: 'Architect',
        agentColor: 'blue',
        agentModel: selectedModel,
        turnNumber: 0,
        collaborationMode: 'sequential',
        sessionId: 'waggle-session-1',
      } as const
      input.waggle.onWaggleEvent(
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
      input.waggle.onTurnEvent({
        type: 'turn-start',
        turnNumber: 0,
        agentIndex: 0,
        agentLabel: 'Architect',
      })
      input.waggle.onTurnEvent({
        type: 'turn-end',
        turnNumber: 0,
        agentIndex: 0,
        agentLabel: 'Architect',
        agentColor: 'blue',
        agentModel: selectedModel,
      })
      input.waggle.onTurnEvent({
        type: 'collaboration-complete',
        reason: 'Reached maximum turns (1)',
        totalTurns: 1,
      })
      return {
        newMessages: [
          {
            id: MessageId('user-message-1'),
            role: 'user',
            parts: [{ type: 'text', text: 'Review the implementation' }],
            createdAt: 9,
          },
          assistantMessage,
        ],
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
              metadataJson: JSON.stringify({
                waggle: {
                  agentIndex: 0,
                  agentLabel: 'Architect',
                  agentColor: 'blue',
                  agentModel: 'openai/gpt-5.4',
                  turnNumber: 0,
                  sessionId: meta.sessionId,
                },
              }),
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

export const TestLayer = Layer.mergeAll(
  TestSessionProjectionLayer,
  TestSettingsLayer,
  TestSessionLayer,
  TestAgentKernelLayer,
)

export function resetWaggleRunServiceMocks() {
  runMock.mockReset()
  persistSnapshotMock.mockReset()
  recordActiveRunMock.mockReset()
  clearActiveRunMock.mockReset()
  clearInterruptedRunsMock.mockReset()
}
